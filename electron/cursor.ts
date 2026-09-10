import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Rect } from '../shared/types';
import type { CursorTrack, CursorSample, CursorClick, CursorShape } from '../shared/cursor';

export const nativePath = (name: string) =>
  path
    .join(__dirname, '../native', name + (process.platform === 'win32' ? '.exe' : ''))
    .replace('app.asar', 'app.asar.unpacked');
interface Raw {
  ms: number;
  x: number;
  y: number;
  buttons: number;
  shape: CursorShape;
  event: string;
}
export class CursorRecorder {
  private child?: ChildProcessWithoutNullStreams;
  private raw: Raw[] = [];
  private started = Date.now();
  constructor(
    private bounds: Rect,
    private nativeVisible: boolean,
  ) {}
  async start() {
    this.raw = [];
    await new Promise<void>((resolve, reject) => {
      const child = (this.child = spawn(nativePath('cursor-helper'), [], { windowsHide: true }));
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Mouse tracking could not start.'));
      }, 10000);
      let pending = '',
        errors = '',
        ready = false;
      child.stdout.on('data', (data) => {
        pending += data;
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines)
          try {
            const value = JSON.parse(line);
            if (value.ready) {
              ready = true;
              clearTimeout(timeout);
              resolve();
            } else if (value.error) {
              clearTimeout(timeout);
              reject(new Error(value.error));
            } else if (Number.isFinite(value.ms)) this.raw.push(value);
          } catch {}
      });
      child.stderr.on('data', (d) => (errors = (errors + d).slice(-2000)));
      child.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.on('close', () => {
        clearTimeout(timeout);
        if (!ready)
          reject(
            new Error(errors || 'Mouse tracking requires Input Monitoring permission for Cutter.'),
          );
      });
    });
  }
  begin(ms = Date.now()) {
    this.started = ms;
  }
  stop() {
    this.child?.kill();
    this.child = undefined;
  }
  async finish(file: string, duration: number) {
    this.stop();
    const samples: CursorSample[] = [],
      clicks: CursorClick[] = [],
      active = new Map<number, CursorClick>();
    let previous = 0;
    for (const raw of this.raw) {
      const t = (raw.ms - this.started) / 1000;
      if (t < 0 || t > duration + 0.1) continue;
      const x = (raw.x - this.bounds.x) / this.bounds.width,
        y = (raw.y - this.bounds.y) / this.bounds.height;
      samples.push({ t: Math.min(t, duration), x, y, shape: raw.shape });
      for (const [bit, button] of [
        [1, 'left'],
        [2, 'right'],
        [4, 'middle'],
      ] as const) {
        if (raw.buttons & bit && !(previous & bit)) {
          const c = {
            id: crypto.randomUUID(),
            t: Math.min(t, duration),
            end: duration,
            button,
            x,
            y,
          };
          clicks.push(c);
          active.set(bit, c);
        }
        if (!(raw.buttons & bit) && previous & bit) {
          const c = active.get(bit);
          if (c) c.end = Math.max(c.t + 0.001, Math.min(t, duration));
          active.delete(bit);
        }
      }
      previous = raw.buttons;
    }
    const track: CursorTrack = {
      version: 1,
      nativeVisible: this.nativeVisible,
      visible: !this.nativeVisible,
      clicksVisible: true,
      smooth: false,
      size: 32,
      samples,
      clicks,
    };
    await fs.writeFile(
      file + '.cutter.json',
      JSON.stringify({ version: 1, original: track, edited: track }),
    );
    return track;
  }
}
export function validateTrack(input: CursorTrack): CursorTrack {
  if (
    !input ||
    !Array.isArray(input.samples) ||
    input.samples.length > 2_000_000 ||
    !Array.isArray(input.clicks) ||
    input.clicks.length > 100_000
  )
    throw new Error('Invalid cursor track.');
  const finite = (v: number) => Number.isFinite(v);
  if (
    input.samples.some(
      (p) => ![p.t, p.x, p.y].every(finite) || !['arrow', 'text', 'hand'].includes(p.shape),
    ) ||
    input.clicks.some(
      (c) =>
        ![c.t, c.end, c.x, c.y].every(finite) ||
        c.end < c.t ||
        !['left', 'right', 'middle'].includes(c.button),
    )
  )
    throw new Error('Invalid cursor event.');
  return {
    ...input,
    version: 1,
    visible: !!input.visible,
    clicksVisible: !!input.clicksVisible,
    smooth: !!input.smooth,
    size: Math.min(128, Math.max(8, Number(input.size) || 32)),
    samples: [...input.samples].sort((a, b) => a.t - b.t),
  };
}
