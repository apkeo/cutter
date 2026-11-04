import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from 'playwright-core';
import type { CursorClick, CursorSample, CursorShape, CursorTrack } from '../shared/cursor';
import type { Rect } from '../shared/types';
import { run } from '../electron/media';
import { concatList, motionFps, placeFrames, type TimedFrame } from './frames';
import type { CaptureSpec, IndexedDbEntry, Step, Target } from './spec';

interface Point {
  x: number;
  y: number;
}
interface Frame extends TimedFrame {
  data: Buffer;
}
interface Recording {
  name: string;
  fps: number;
  cdp: CDPSession;
  started: number;
  poster: Buffer;
  frames: Frame[];
  samples: CursorSample[];
  clicks: CursorClick[];
}
export interface ImageOutput {
  kind: 'image';
  name: string;
  path: string;
  rect?: Rect;
}
export interface VideoOutput {
  kind: 'video';
  name: string;
  path: string;
  cursor: string;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  frames: number;
  motionFps: number;
  clicks: number;
}
export type CaptureOutput = ImageOutput | VideoOutput;
export interface CaptureResult {
  version: 1;
  url: string;
  viewport: CaptureSpec['viewport'];
  outputs: CaptureOutput[];
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function launch(spec: CaptureSpec): Promise<Browser> {
  const { channel, headless } = spec.browser;
  const channels = channel ? [channel] : [undefined, 'chrome', 'msedge'];
  let failure: unknown;
  for (const candidate of channels) {
    try {
      return await chromium.launch({ channel: candidate, headless });
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(
    `No browser could start. Run "npx playwright-core install chromium" or set browser.channel in the spec.\n${
      failure instanceof Error ? failure.message : String(failure)
    }`,
  );
}

function styleScript(css: string) {
  return `(() => {
    const add = () => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.documentElement.appendChild(style);
    };
    if (document.documentElement) add();
    else document.addEventListener('DOMContentLoaded', add);
  })()`;
}

async function openContext(browser: Browser, spec: CaptureSpec) {
  const { viewport, session } = spec;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    locale: spec.locale,
    timezoneId: spec.timezone,
    colorScheme: spec.colorScheme,
    storageState: session?.storageState,
  });
  context.setDefaultTimeout(spec.timeout);
  if (spec.clock) await context.clock.setFixedTime(new Date(spec.clock));
  const hidden = spec.hide.map((selector) => `${selector}{visibility:hidden!important}`).join('');
  if (hidden || spec.css) await context.addInitScript({ content: styleScript(hidden + spec.css) });
  if (spec.initScript) await context.addInitScript({ content: spec.initScript });
  for (const pattern of session?.blockRequests ?? [])
    await context.route(pattern, (route) => route.abort());
  if (session?.cookies.length) await context.addCookies(session.cookies);
  return context;
}

async function writeIndexedDb(entries: IndexedDbEntry[]) {
  for (const entry of entries) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(entry.database);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains(entry.store)) {
      db.close();
      throw new Error(`IndexedDB store ${entry.database}/${entry.store} does not exist.`);
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(entry.store, 'readwrite');
      transaction.objectStore(entry.store).put(entry.value, entry.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }
}

async function seedSession(page: Page, spec: CaptureSpec) {
  const session = spec.session;
  if (!session?.origin) return;
  await page.goto(session.origin, { waitUntil: 'domcontentloaded' });
  if (session.settle) await page.waitForTimeout(session.settle);
  if (Object.keys(session.localStorage).length)
    await page.evaluate((values) => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    }, session.localStorage);
  if (session.indexedDb.length) await page.evaluate(writeIndexedDb, session.indexedDb);
}

class Director {
  private at: Point;
  private shape: CursorShape = 'arrow';
  private recording?: Recording;

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly spec: CaptureSpec,
    private readonly outDir: string,
    private readonly ffmpeg: string,
    readonly outputs: CaptureOutput[],
  ) {
    this.at = { x: spec.viewport.width * 0.62, y: spec.viewport.height * 0.55 };
  }

  private locator(target: Target): Locator {
    if (target.selector) return this.page.locator(target.selector).first();
    if (target.testId)
      return this.page
        .locator(`[${this.spec.testIdAttribute}=${JSON.stringify(target.testId)}]`)
        .first();
    if (target.role)
      return this.page
        .getByRole(target.role as Parameters<Page['getByRole']>[0], {
          name: target.name,
          exact: target.exact,
        })
        .first();
    return this.page.getByText(target.text!, { exact: target.exact }).first();
  }

  private async box(target: Target): Promise<Rect> {
    if (target.expression) {
      const rect = (await this.page.evaluate(target.expression)) as Rect | null;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
        throw new Error(`Expression did not return a rectangle: ${target.expression}`);
      return rect;
    }
    const locator = this.locator(target);
    await locator.waitFor({ state: 'visible' });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('The element has no visible box.');
    return box;
  }

  private async center(target: Target): Promise<Point> {
    const box = await this.box(target);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  private async shapeAt(point: Point): Promise<CursorShape> {
    return this.page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      const cursor = element ? getComputedStyle(element).cursor : 'auto';
      return cursor === 'pointer' ? 'hand' : cursor === 'text' ? 'text' : 'arrow';
    }, point);
  }

  private seconds() {
    return this.recording ? (Date.now() - this.recording.started) / 1000 : 0;
  }

  private sample(point = this.at, shape = this.shape) {
    this.recording?.samples.push({
      t: this.seconds(),
      x: point.x / this.spec.viewport.width,
      y: point.y / this.spec.viewport.height,
      shape,
    });
  }

  private async glide(to: Point, duration?: number) {
    if (!this.recording) {
      await this.page.mouse.move(to.x, to.y);
      this.at = to;
      this.shape = await this.shapeAt(to);
      return;
    }
    const from = this.at;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const ms = duration ?? clamp(300 + distance * 0.35, 350, 900);
    const firstSample = this.recording.samples.length;
    const started = Date.now();
    const progressAt: number[] = [];
    for (;;) {
      const linear = Math.min(1, (Date.now() - started) / ms);
      const progress = ease(linear);
      const arc = Math.sin(Math.PI * progress) * Math.min(40, distance * 0.08);
      const point = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress - arc,
      };
      await this.page.mouse.move(point.x, point.y);
      this.sample(point, 'arrow');
      progressAt.push(linear);
      if (linear >= 1) break;
    }
    this.at = to;
    this.shape = await this.shapeAt(to);
    const samples = this.recording.samples;
    progressAt.forEach((linear, index) => {
      if (linear >= 0.85) samples[firstSample + index].shape = this.shape;
    });
  }

  private async pause(ms: number) {
    this.sample();
    await this.page.waitForTimeout(ms);
    this.sample();
  }

  private async click(step: Extract<Step, { action: 'click' }>) {
    if (!step.target.expression) {
      const locator = this.locator(step.target);
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ trial: true });
    }
    const point = await this.center(step.target);
    await this.glide(point, step.duration);
    if (this.recording) await this.pause(140);
    const t = this.seconds();
    await this.page.mouse.down({ button: step.button });
    await this.page.waitForTimeout(70);
    await this.page.mouse.up({ button: step.button });
    this.recording?.clicks.push({
      id: crypto.randomUUID(),
      t,
      end: this.seconds(),
      button: step.button,
      x: point.x / this.spec.viewport.width,
      y: point.y / this.spec.viewport.height,
    });
    this.shape = await this.shapeAt(point);
    this.sample();
  }

  private async type(step: Extract<Step, { action: 'type' }>) {
    if (step.target) await this.click({ action: 'click', target: step.target, button: 'left' });
    await this.page.keyboard.type(step.text, { delay: step.delay ?? (this.recording ? 35 : 0) });
    if (step.submit) await this.page.keyboard.press('Enter');
    this.sample();
  }

  private async scroll(step: Extract<Step, { action: 'scroll' }>) {
    if (step.target) await this.glide(await this.center(step.target));
    const ticks = Math.max(1, Math.round(step.duration / 16));
    for (let tick = 0; tick < ticks; tick++) {
      await this.page.mouse.wheel(step.x / ticks, step.y / ticks);
      await this.page.waitForTimeout(16);
    }
    this.sample();
  }

  private async screenshot(step: Extract<Step, { action: 'screenshot' }>) {
    const file = path.join(this.outDir, `${step.name}.${step.format === 'jpeg' ? 'jpg' : 'png'}`);
    let rect: Rect | undefined;
    if (step.targets.length && !step.fullPage) {
      const boxes = await Promise.all(step.targets.map((target) => this.box(target)));
      const { width, height } = this.spec.viewport;
      const left = Math.floor(clamp(Math.min(...boxes.map((b) => b.x)) - step.padding, 0, width));
      const top = Math.floor(clamp(Math.min(...boxes.map((b) => b.y)) - step.padding, 0, height));
      const right = Math.ceil(
        clamp(Math.max(...boxes.map((b) => b.x + b.width)) + step.padding, 0, width),
      );
      const bottom = Math.ceil(
        clamp(Math.max(...boxes.map((b) => b.y + b.height)) + step.padding, 0, height),
      );
      if (right <= left || bottom <= top) throw new Error('The screenshot area is off screen.');
      rect = { x: left, y: top, width: right - left, height: bottom - top };
    }
    await this.page.screenshot({
      path: file,
      type: step.format,
      clip: rect,
      fullPage: step.fullPage,
      scale: 'device',
      caret: 'hide',
    });
    this.outputs.push({ kind: 'image', name: step.name, path: file, rect });
  }

  private async startRecording(step: Extract<Step, { action: 'record' }>) {
    const { width, height, scale } = this.spec.viewport;
    await this.page.mouse.move(this.at.x, this.at.y);
    this.shape = await this.shapeAt(this.at);
    const poster = await this.page.screenshot({ type: 'jpeg', quality: 92, scale: 'device' });
    const cdp = await this.context.newCDPSession(this.page);
    const frames: Frame[] = [];
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      frames.push({
        data: Buffer.from(data, 'base64'),
        timestamp: metadata.timestamp ?? Date.now() / 1000,
        arrived: Date.now() / 1000,
      });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: Math.round(width * scale),
      maxHeight: Math.round(height * scale),
      everyNthFrame: 1,
    });
    this.recording = {
      name: step.name,
      fps: step.fps,
      cdp,
      started: Date.now(),
      poster,
      frames,
      samples: [],
      clicks: [],
    };
    this.sample();
  }

  async stopRecording() {
    const recording = this.recording;
    if (!recording) return;
    this.sample();
    await recording.cdp.send('Page.stopScreencast');
    const stopped = Date.now();
    await recording.cdp.detach().catch(() => {});
    this.recording = undefined;
    const { width, height, scale } = this.spec.viewport;
    const videoWidth = Math.round(width * scale),
      videoHeight = Math.round(height * scale);
    const placed = placeFrames(recording.frames, recording.started / 1000, stopped / 1000).map(
      (frame) => ({ ...frame, index: frame.index + 1 }),
    );
    const images = [recording.poster, ...recording.frames.map((frame) => frame.data)];
    const seconds = (stopped - recording.started) / 1000;
    const lead = seconds - placed.reduce((sum, frame) => sum + frame.duration, 0);
    const list =
      lead > 0.001 || !placed.length ? [{ index: 0, duration: lead }, ...placed] : placed;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cutter-capture-'));
    const name = (index: number) => `f${String(index).padStart(6, '0')}.jpg`;
    try {
      await Promise.all(
        [...new Set(list.map((frame) => frame.index))].map((index) =>
          fs.writeFile(path.join(temp, name(index)), images[index]),
        ),
      );
      await fs.writeFile(path.join(temp, 'frames.txt'), concatList(list, name));
      const output = path.join(this.outDir, `${recording.name}.mp4`);
      await run(
        this.ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          'frames.txt',
          '-vf',
          `fps=${recording.fps},scale=${videoWidth}:${videoHeight}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '14',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          output,
        ],
        undefined,
        undefined,
        temp,
      );
      const track: CursorTrack = {
        version: 1,
        nativeVisible: false,
        visible: this.spec.cursor.visible,
        clicksVisible: this.spec.cursor.clicks,
        smooth: this.spec.cursor.smooth,
        size: Math.round(this.spec.cursor.size * scale),
        samples: recording.samples,
        clicks: recording.clicks,
      };
      const cursor = `${output}.cutter.json`;
      await fs.writeFile(cursor, JSON.stringify({ version: 1, original: track, edited: track }));
      this.outputs.push({
        kind: 'video',
        name: recording.name,
        path: output,
        cursor,
        width: videoWidth,
        height: videoHeight,
        fps: recording.fps,
        seconds: Number(seconds.toFixed(2)),
        frames: list.length,
        motionFps: motionFps(list),
        clicks: recording.clicks.length,
      });
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  async run(step: Step) {
    switch (step.action) {
      case 'goto':
        await this.page.goto(new URL(step.url, this.page.url()).href, {
          waitUntil: 'domcontentloaded',
        });
        return;
      case 'wait':
        await this.pause(step.ms);
        return;
      case 'waitFor':
        if (step.target.expression) {
          await this.page.waitForFunction(step.target.expression, undefined, {
            timeout: step.timeout ?? this.spec.timeout,
          });
        } else {
          await this.locator(step.target).waitFor({ state: step.state, timeout: step.timeout });
        }
        this.sample();
        return;
      case 'move':
        await this.glide(await this.center(step.target), step.duration);
        return;
      case 'click':
        await this.click(step);
        return;
      case 'type':
        await this.type(step);
        return;
      case 'press':
        await this.page.keyboard.press(step.keys);
        this.sample();
        return;
      case 'scroll':
        await this.scroll(step);
        return;
      case 'eval':
        await this.page.evaluate(step.expression);
        return;
      case 'screenshot':
        await this.screenshot(step);
        return;
      case 'record':
        await this.startRecording(step);
        return;
      case 'stop':
        await this.stopRecording();
        return;
    }
  }
}

export async function capture(
  spec: CaptureSpec,
  outDir: string,
  ffmpeg: string,
): Promise<CaptureResult> {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await launch(spec);
  try {
    const context = await openContext(browser, spec);
    const page = await context.newPage();
    await seedSession(page, spec);
    await page.goto(spec.url, { waitUntil: 'domcontentloaded' });
    const outputs: CaptureOutput[] = [];
    const director = new Director(page, context, spec, outDir, ffmpeg, outputs);
    for (const [index, step] of spec.steps.entries()) {
      try {
        await director.run(step);
      } catch (error) {
        await page.screenshot({ path: path.join(outDir, 'failure.png') }).catch(() => {});
        throw new Error(
          `Step ${index + 1} (${step.action}) failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await director.stopRecording();
    const result: CaptureResult = { version: 1, url: page.url(), viewport: spec.viewport, outputs };
    await fs.writeFile(path.join(outDir, 'capture.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await browser.close();
  }
}
