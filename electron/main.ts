import { QuickTray } from './tray';
import { CursorRecorder, nativePath, validateTrack } from './cursor';
import { renderCursorOverlay } from './cursor-render';
import type { CursorTrack } from '../shared/cursor';
import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  dialog,
  shell,
  clipboard,
  protocol,
  net,
  desktopCapturer,
  session,
  systemPreferences,
  ClipboardItem,
} from 'electron';
import type { Display, WebContents, IpcMainInvokeEvent } from 'electron';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Settings, Media, ExportRequest, Rect, CaptureSession } from '../shared/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { classify, composition, exportArgs, IMAGE_EXT, VIDEO_EXT } from './model';
const unpack = (p: string) => p.replace('app.asar', 'app.asar.unpacked');
const ffmpeg = unpack(require('ffmpeg-static') as string);
const ffprobe = unpack(require('ffprobe-static').path);
if (process.env.CUTTER_TEST_HOME) app.setPath('userData', process.env.CUTTER_TEST_HOME);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cutter-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
type PickerWindow = BrowserWindow & { display: Display };
let main: BrowserWindow,
  pickers: PickerWindow[] = [],
  controls: BrowserWindow | null,
  settings: Settings;
const quickTray = new QuickTray(() =>
  secureWindow(
    {
      width: 340,
      height: 414,
      show: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
    },
    'tray.html',
  ),
);
function minimizeStudio() {
  main.hide();
  if (process.platform === 'darwin') app.dock?.hide();
}
function showStudio() {
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}
async function rememberOutput(file: string) {
  outputFiles.add(file);
  settings.lastSavedFile = file;
  await save();
}
let cursorSaveQueue = Promise.resolve();
let cursorRecorder: CursorRecorder | undefined;
let nativeRecording:
  | {
      child: import('node:child_process').ChildProcessWithoutNullStreams;
      output: string;
      stopping: boolean;
    }
  | undefined;
let recording: {
  child: ChildProcessWithoutNullStreams;
  output: string;
  started: number;
  stopping: boolean;
} | null;
let exporting: (ChildProcessWithoutNullStreams & { cancelled?: boolean }) | null;
let picking = false;
let browserCapture: {
  window: BrowserWindow;
  displayId: number;
  job: CaptureSession;
  output: string;
  raw: string;
  bytes: number;
  stopping: boolean;
} | null = null;
const assets = new Map<string, string>(),
  mediaStore = new Map<string, Media>(),
  outputFiles = new Set<string>();
const send = (channel: string, data: unknown) => {
  if (main && !main.isDestroyed()) main.webContents.send(channel, data);
};
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
async function persist() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const p = settingsPath();
  await fs.writeFile(p + '.tmp', JSON.stringify(settings, null, 2));
  await fs.rename(p + '.tmp', p);
}
let settingsQueue = Promise.resolve();
function save() {
  settingsQueue = settingsQueue.catch(() => {}).then(persist);
  return settingsQueue;
}
function secureWindow(options: Electron.BrowserWindowConstructorOptions, page: string) {
  const w = new BrowserWindow({
    frame: false,
    backgroundColor: '#111312',
    icon: path.join(__dirname, '../../assets/icon.png'),
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const query = { page: page.replace('.html', '') };
  if (process.env.CUTTER_DEV_URL) w.loadURL(process.env.CUTTER_DEV_URL + '?page=' + query.page);
  else w.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  return w;
}
function registerShortcut(accelerator: string) {
  if (accelerator === settings?.shortcut && globalShortcut.isRegistered(accelerator)) return true;
  try {
    return globalShortcut.register(accelerator, () => {
      if (recording || browserCapture || nativeRecording) stopRecording();
      else openPicker().catch(report);
    });
  } catch {
    return false;
  }
}
function report(e: unknown) {
  send('error', e instanceof Error ? e.message : String(e));
  main?.show();
}
function run(
  binary: string,
  args: string[],
  onProgress?: (text: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, env });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
      onProgress?.(String(data));
    });
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-6000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `Media process exited (${code})`)),
    );
  });
}
function asset(file: string) {
  const id = crypto.randomUUID();
  assets.set(id, file);
  return `cutter-media://asset/${id}`;
}
async function inspect(file: string): Promise<Media> {
  const kind = classify(file);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose a media file.');
  const info: {
    streams: {
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
      side_data_list?: { rotation?: number }[];
      tags?: { rotate?: string };
    }[];
    format: { duration?: string };
  } = JSON.parse(
    await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]),
  );
  const video = info.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('No image or video stream found.');
  const [n, d] = (video.avg_frame_rate || video.r_frame_rate || '30/1').split('/').map(Number);
  const rotation =
    Math.abs(
      Number(
        video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ||
          video.tags?.rotate ||
          0,
      ),
    ) %
      180 ===
    90;
  const media: Media = {
    url: '',
    id: crypto.randomUUID(),
    path: file,
    name: path.basename(file),
    kind,
    width: rotation ? video.height : video.width,
    height: rotation ? video.width : video.height,
    fps: n / d || 30,
    duration: kind === 'image' ? 0 : Number(info.format.duration || video.duration || 0),
    size: stat.size,
    hasAudio: info.streams.some((stream) => stream.codec_type === 'audio'),
  };
  try {
    const sidecar = JSON.parse(await fs.readFile(file + '.cutter.json', 'utf8'));
    media.cursor = validateTrack(sidecar.edited);
  } catch {}
  if (kind === 'video' && !media.duration) {
    const packets: { packets: { pts_time?: string; duration_time?: string }[] } = JSON.parse(
      await run(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'packet=pts_time,duration_time',
        '-of',
        'json',
        file,
      ]),
    );
    media.duration = packets.packets.reduce(
      (end, p) => Math.max(end, Number(p.pts_time || 0) + Number(p.duration_time || 0)),
      0,
    );
  }
  if (!media.width || !media.height || (kind === 'video' && !media.duration))
    throw new Error('Could not read media dimensions or duration.');
  // Normalize preview only; exports always read the original source.
  const previewDir = path.join(app.getPath('userData'), 'previews');
  await fs.mkdir(previewDir, { recursive: true });
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${file}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 24);
  const exists = async (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    );
  let preview = file;
  if (
    kind === 'image' &&
    !['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(path.extname(file).slice(1).toLowerCase())
  ) {
    preview = path.join(previewDir, cacheKey + '.png');
    if (!(await exists(preview)))
      await run(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', preview]);
  } else if (
    kind === 'video' &&
    !(
      ['.mp4', '.m4v', '.webm'].includes(path.extname(file).toLowerCase()) &&
      ['h264', 'vp8', 'vp9', 'av1'].includes(video.codec_name)
    )
  ) {
    send('status', 'Preparing preview…');
    preview = path.join(previewDir, cacheKey + '.mp4');
    if (!(await exists(preview)))
      await run(ffmpeg, [
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        preview,
      ]);
  }
  media.url = asset(preview);
  mediaStore.set(media.id, media);
  settings.lastFile = file;
  await save();
  return media;
}
let pickerMove: ReturnType<typeof setInterval> | undefined;
function stopPickerMove() {
  if (pickerMove) clearInterval(pickerMove);
  pickerMove = undefined;
}
function closePickers() {
  stopPickerMove();
  for (const w of pickers) if (!w.isDestroyed()) w.close();
  pickers = [];
  picking = false;
}
async function openPicker() {
  if (recording || browserCapture || nativeRecording || picking || exporting) return;
  if (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('screen') !== 'granted'
  ) {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      throw new Error(
        'Allow Cutter in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Cutter.',
      );
    }
  }
  picking = true;
  main.hide();
  const display =
    screen.getAllDisplays().find((d) => d.id === settings.region?.displayId) ||
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  {
    const displays = screen.getAllDisplays();
    const bounds = {
      x: Math.min(...displays.map((d) => d.bounds.x)),
      y: Math.min(...displays.map((d) => d.bounds.y)),
      width:
        Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)) -
        Math.min(...displays.map((d) => d.bounds.x)),
      height:
        Math.max(...displays.map((d) => d.bounds.y + d.bounds.height)) -
        Math.min(...displays.map((d) => d.bounds.y)),
    };
    const w = secureWindow(
      {
        ...bounds,
        enableLargerThanScreen: true,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
      },
      'picker.html',
    ) as PickerWindow;
    w.setBounds(bounds);
    w.display = display;
    w.setAlwaysOnTop(true, 'screen-saver');
    pickers.push(w);
  }
}
async function outputPath(prefix: string, ext: string) {
  await fs.mkdir(settings.folder, { recursive: true });
  return path.join(
    settings.folder,
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}.${ext}`,
  );
}
async function startCapture(
  sender: WebContents,
  data: { rect: Rect; mode: 'screenshot' | 'record' },
) {
  const picker = pickers.find((w) => w.webContents === sender);
  if (!picker || recording || browserCapture || nativeRecording)
    throw new Error('Open the screen picker first.');
  const display = picker.display;
  const b = display.bounds;
  const r: Rect = {
    width: 2,
    height: 2,
    x: Math.max(0, Math.min(b.width - 2, Math.round(data.rect.x))),
    y: Math.max(0, Math.min(b.height - 2, Math.round(data.rect.y))),
  };
  r.width = Math.max(2, Math.min(b.width - r.x, Math.round(data.rect.width)));
  r.height = Math.max(2, Math.min(b.height - r.y, Math.round(data.rect.height)));
  if (!Object.values(r).every(Number.isFinite)) throw new Error('Invalid capture region.');
  settings.region = { ...r, displayId: display.id };
  await save();
  if (data.mode === 'record') {
    const bounds =
      process.platform === 'win32'
        ? screen.dipToScreenRect(null, {
            x: b.x + r.x,
            y: b.y + r.y,
            width: r.width,
            height: r.height,
          })
        : { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height };
    cursorRecorder = new CursorRecorder(bounds, settings.cursor);
    try {
      await cursorRecorder.start();
    } catch (error) {
      cursorRecorder.stop();
      cursorRecorder = undefined;
      throw error;
    }
  }
  if (process.platform === 'darwin' && data.mode === 'record') {
    closePickers();
    await new Promise((resolve) => setTimeout(resolve, 220));
    const output = await outputPath('Recording', 'mp4');
    const child = spawn(
      nativePath('capture-helper'),
      [
        String(display.id),
        String(r.x),
        String(r.y),
        String(r.width),
        String(r.height),
        String(settings.captureFps),
        String(display.scaleFactor),
        settings.cursor ? '1' : '0',
        output,
      ],
      { windowsHide: true },
    );
    nativeRecording = { child, output, stopping: false };
    let pending = '',
      errorText = '';
    child.stdout.on('data', (data) => {
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines)
        try {
          const message = JSON.parse(line);
          if (message.ready) {
            cursorRecorder?.begin(message.ms);
            showRecordingControls(display, r);
            send('recording', true);
          }
          if (message.error) errorText = message.error;
        } catch {}
    });
    child.stderr.on('data', (d) => (errorText = (errorText + d).slice(-2000)));
    child.on('error', (e) => {
      cursorRecorder?.stop();
      cursorRecorder = undefined;
      nativeRecording = undefined;
      main.show();
      report(e);
    });
    child.on('close', async (code) => {
      nativeRecording = undefined;
      controls?.close();
      controls = null;
      send('recording', false);
      main.show();
      try {
        if (code !== 0) throw new Error(errorText || 'Recording failed.');
        const media = await inspect(output);
        if (cursorRecorder) media.cursor = await cursorRecorder.finish(output, media.duration);
        await rememberOutput(output);
        send('media', media);
      } catch (e) {
        report(e);
      } finally {
        cursorRecorder?.stop();
        cursorRecorder = undefined;
      }
    });
    return;
  }
  if (process.platform === 'darwin' || process.env.CUTTER_CAPTURE_ENGINE === 'browser') {
    closePickers();
    await new Promise((resolve) => setTimeout(resolve, 220));
    const output = await outputPath(
      data.mode === 'screenshot' ? 'Screenshot' : 'Recording',
      data.mode === 'screenshot' ? 'png' : 'mp4',
    );
    const raw = data.mode === 'screenshot' ? output : output.replace(/\.mp4$/, '.webm');
    await fs.writeFile(raw, Buffer.alloc(0));
    const worker = secureWindow(
      { width: 64, height: 64, show: false, skipTaskbar: true },
      'capture.html',
    );
    browserCapture = {
      window: worker,
      displayId: display.id,
      output,
      raw,
      bytes: 0,
      stopping: false,
      job: {
        rect: r,
        display: { width: b.width, height: b.height },
        fps: settings.captureFps,
        cursor: settings.cursor,
        mode: data.mode,
      },
    };
    worker.webContents.once('did-finish-load', () => {
      worker.webContents
        .executeJavaScript("document.getElementById('begin-capture').click()", true)
        .catch(report);
    });
    worker.webContents.once('render-process-gone', () => {
      if (browserCapture?.window === worker) {
        browserCapture = null;
        controls?.close();
        main.show();
        report(new Error(`Recording was interrupted. Recoverable data: ${raw}`));
      }
    });
    return;
  }
  const physical = screen.dipToScreenRect(null, {
    x: b.x + r.x,
    y: b.y + r.y,
    width: r.width,
    height: r.height,
  });
  closePickers();
  await new Promise((resolve) => setTimeout(resolve, 220));
  const image = data.mode === 'screenshot';
  const output = await outputPath(image ? 'Screenshot' : 'Recording', image ? 'png' : 'mp4');
  const args = [
    '-hide_banner',
    '-y',
    '-f',
    'gdigrab',
    '-framerate',
    String(settings.captureFps),
    '-offset_x',
    String(physical.x),
    '-offset_y',
    String(physical.y),
    '-video_size',
    `${physical.width}x${physical.height}`,
    '-draw_mouse',
    settings.cursor ? '1' : '0',
    '-i',
    'desktop',
  ];
  if (image) {
    await run(ffmpeg, [...args, '-frames:v', '1', output]);
    await rememberOutput(output);
    const m = await inspect(output);
    send('media', m);
    main.show();
    return;
  }
  const child = spawn(
    ffmpeg,
    [
      ...args,
      '-vf',
      'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-progress',
      'pipe:1',
      '-stats_period',
      '0.02',
      output,
    ],
    { windowsHide: true },
  );
  cursorRecorder?.begin();
  recording = { child, output, started: Date.now(), stopping: false };
  let clockAligned = false,
    clockBuffer = '';
  child.stdout.on('data', (data) => {
    if (clockAligned) return;
    clockBuffer += data;
    const match = clockBuffer.match(/out_time_us=(\d+)/);
    if (match && Number(match[1]) > 0) {
      cursorRecorder?.begin(Date.now() - Number(match[1]) / 1000);
      clockAligned = true;
    }
  });
  let errorText = '';
  child.stderr.on('data', (d) => {
    errorText = (errorText + d).slice(-3000);
  });
  child.on('error', (e) => {
    recording = null;
    controls?.close();
    cursorRecorder?.stop();
    cursorRecorder = undefined;
    report(e);
  });
  child.on('close', async (code) => {
    recording = null;
    controls?.close();
    controls = null;
    send('recording', false);
    main.show();
    if (code !== 0) {
      cursorRecorder?.stop();
      cursorRecorder = undefined;
      return report(new Error(errorText || 'Recording failed.'));
    }
    try {
      await rememberOutput(output);
      const media = await inspect(output);
      if (cursorRecorder) media.cursor = await cursorRecorder.finish(output, media.duration);
      cursorRecorder = undefined;
      send('media', media);
    } catch (e) {
      report(e);
    }
  });
  showRecordingControls(display, r);
  send('recording', true);
}
function showRecordingControls(display: Display, r: Rect) {
  const b = display.bounds;
  const captureBounds = { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height };
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const candidates = screen.getAllDisplays().flatMap((d) => {
    const a = d.workArea;
    return [
      { x: a.x + 20, y: a.y + 20 },
      { x: a.x + a.width - 310, y: a.y + 20 },
      { x: a.x + 20, y: a.y + a.height - 90 },
      { x: a.x + a.width - 310, y: a.y + a.height - 90 },
    ].map((p) => ({ ...p, width: 290, height: 70 }));
  });
  const dock = candidates.find((candidate) => !overlaps(candidate, captureBounds));
  controls = secureWindow(
    {
      x: dock?.x ?? b.x,
      y: dock?.y ?? b.y,
      width: 290,
      height: 70,
      show: Boolean(dock),
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
    },
    'recording.html',
  );
  controls.setContentProtection(true);
}
function stopRecording() {
  cursorRecorder?.stop();
  if (nativeRecording && !nativeRecording.stopping) {
    nativeRecording.stopping = true;
    nativeRecording.child.stdin.write('stop\n');
    return;
  }
  if (browserCapture && !browserCapture.stopping) {
    browserCapture.stopping = true;
    browserCapture.window.webContents.send('capture-stop');
    return;
  }
  if (recording && !recording.stopping) {
    recording.stopping = true;
    recording.child.stdin.write('q');
  }
}
async function performFileAction(action: string, file: string) {
  if (!outputFiles.has(file)) throw new Error('Unknown output file.');
  if (action === 'path') await clipboard.writeText(file);
  if (action === 'reveal') shell.showItemInFolder(file);
  if (action === 'copy') {
    if (process.platform === 'darwin') {
      await clipboard.write([
        new ClipboardItem({
          'electron application/osclipboard;format="public.file-url"': new Blob([
            pathToFileURL(file).href,
          ]),
        }),
      ]);
      return true;
    }
    // Use the native FileDrop format. Electron custom formats register a different
    // clipboard format even when named CF_HDROP, which Explorer cannot paste.
    // The path is data in an environment variable, never interpolated into code.
    await run(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add($env:CUTTER_CLIPBOARD_FILE); [System.Windows.Forms.Clipboard]::SetFileDropList($files)",
      ],
      undefined,
      { ...process.env, CUTTER_CLIPBOARD_FILE: file },
    );
  }
  return true;
}

function handle<T extends unknown[]>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: T) => unknown,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    const valid = [main, controls, quickTray.window, browserCapture?.window, ...pickers].some(
      (w) => w && !w.isDestroyed() && w.webContents === event.sender,
    );
    if (!valid || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted request.');
    return fn(event, ...(args as T));
  });
}
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const capture = browserCapture;
        if (!capture || request.frame !== capture.window.webContents.mainFrame) return callback({});
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const source = sources.find((source) => source.display_id === String(capture.displayId));
        callback(source ? { video: source } : {});
      } catch {
        callback({});
      }
    });
    settings = {
      shortcut: 'CommandOrControl+Shift+2',
      folder: path.join(app.getPath('videos'), 'Cutter'),
      language: 'en',
      captureFps: 30,
      cursor: true,
      minimizeToTray: true,
      editor: {
        width: 1920,
        height: 1080,
        padding: 64,
        radius: 8,
        background: '#d7e3d1',
        muted: false,
        fps: 30,
        crop: { x: 0, y: 0, width: 1920, height: 1080 },
        start: 0,
        end: 0,
      },
    };
    try {
      const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
      settings = { ...settings, ...stored, editor: { ...settings.editor, ...stored.editor } };
    } catch {}
    protocol.handle('cutter-media', async (request) => {
      const p = assets.get(new URL(request.url).pathname.slice(1));
      if (!p) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(p).href, { headers: request.headers });
      const headers = new Headers(response.headers);
      headers.set(
        'Access-Control-Allow-Origin',
        process.env.CUTTER_DEV_URL ? new URL(process.env.CUTTER_DEV_URL).origin : 'null',
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
    main = secureWindow(
      { width: 1440, height: 960, minWidth: 1080, minHeight: 740, show: false },
      'index.html',
    );
    main.on('show', () => {
      if (process.platform === 'darwin') void app.dock?.show();
    });
    main.on('minimize', () => {
      if (settings.minimizeToTray) minimizeStudio();
    });
    main.on('closed', () => {
      quickTray.destroy();
      app.quit();
    });
    main.once('ready-to-show', () => {
      main.show();
      quickTray.configure(settings.minimizeToTray);
      if (!registerShortcut(settings.shortcut))
        send('error', 'Capture shortcut is unavailable. Choose another in Settings.');
    });
    main.on('close', (e) => {
      if (recording || browserCapture || nativeRecording) {
        e.preventDefault();
        stopRecording();
      } else if (exporting) {
        e.preventDefault();
        send('error', 'Wait for export to finish or cancel it first.');
      } else closePickers();
    });
    handle('settings:get', () => settings);
    handle('settings:save', async (_, value: Partial<Settings>) => {
      if (value.shortcut && value.shortcut !== settings.shortcut) {
        if (!registerShortcut(value.shortcut))
          throw new Error('This shortcut is unavailable. Try another combination.');
        globalShortcut.unregister(settings.shortcut);
        settings.shortcut = value.shortcut;
      }
      if (value.language === 'en' || value.language === 'pl') settings.language = value.language;
      if ([24, 30, 60].includes(Number(value.captureFps)))
        settings.captureFps = Number(value.captureFps);
      if (typeof value.cursor === 'boolean') settings.cursor = value.cursor;
      if (typeof value.minimizeToTray === 'boolean') {
        settings.minimizeToTray = value.minimizeToTray;
        quickTray.configure(value.minimizeToTray);
        if (!value.minimizeToTray && !main.isVisible()) showStudio();
      }
      if (value.editor) settings.editor = { ...settings.editor, ...value.editor };
      await save();
      return settings;
    });
    handle('folder:choose', async () => {
      const result = await dialog.showOpenDialog(main, {
        defaultPath: settings.folder,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled) {
        settings.folder = result.filePaths[0];
        await save();
      }
      return settings.folder;
    });
    handle('media:open', async () => {
      const result = await dialog.showOpenDialog(main, {
        properties: ['openFile'],
        filters: [{ name: 'Media', extensions: [...IMAGE_EXT, ...VIDEO_EXT] }],
      });
      if (!result.canceled) return inspect(result.filePaths[0]);
    });
    handle('media:import', (_, file: string) => inspect(file));
    handle('cursor:save', (_, id: string, track: CursorTrack) => {
      const saveTrack = async () => {
        const media = mediaStore.get(id);
        if (!media?.cursor) throw new Error('This file has no cursor recording.');
        const edited = validateTrack(track);
        const file = media.path + '.cutter.json';
        const stored = JSON.parse(await fs.readFile(file, 'utf8'));
        await fs.writeFile(file + '.tmp', JSON.stringify({ ...stored, edited }));
        await fs.rename(file + '.tmp', file);
        media.cursor = edited;
      };
      cursorSaveQueue = cursorSaveQueue.catch(() => {}).then(saveTrack);
      return cursorSaveQueue;
    });
    handle('picker:open', openPicker);
    handle('picker:move', (e, rect: import('../shared/types').Rect | null) => {
      const picker = pickers.find((w) => w.webContents === e.sender);
      if (!picker) return;
      stopPickerMove();
      if (!rect) {
        void save();
        return;
      }
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
      const initial = screen.getCursorScreenPoint();
      const anchor = {
        x: initial.x - picker.display.bounds.x - rect.x,
        y: initial.y - picker.display.bounds.y - rect.y,
      };
      pickerMove = setInterval(() => {
        if (picker.isDestroyed()) {
          stopPickerMove();
          return;
        }
        const cursor = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        if (display.id !== picker.display.id) {
          picker.display = display;
          // Keep the native window stationary so pointer capture survives display changes.
        }
        const width = Math.min(Math.max(2, rect.width), display.bounds.width);
        const height = Math.min(Math.max(2, rect.height), display.bounds.height);
        const moved = {
          x: Math.max(
            0,
            Math.min(display.bounds.width - width, cursor.x - display.bounds.x - anchor.x),
          ),
          y: Math.max(
            0,
            Math.min(display.bounds.height - height, cursor.y - display.bounds.y - anchor.y),
          ),
          width,
          height,
        };
        settings.region = { ...moved, displayId: display.id };
        picker.webContents.send('picker-region', { rect: moved, bounds: display.bounds });
      }, 16);
    });
    handle('picker:init', (e) => ({
      settings,
      viewport: pickers.find((w) => w.webContents === e.sender)?.getBounds(),
      display: pickers.find((w) => w.webContents === e.sender)?.display,
    }));
    handle('picker:cancel', () => {
      closePickers();
      main.show();
    });
    handle('capture:start', (e, data: { rect: Rect; mode: 'screenshot' | 'record' }) =>
      startCapture(e.sender, data).catch((e) => {
        main.show();
        throw e;
      }),
    );
    handle('capture:stop', stopRecording);
    const captureFor = (event: IpcMainInvokeEvent) => {
      if (!browserCapture || browserCapture.window.webContents !== event.sender)
        throw new Error('No active capture session.');
      return browserCapture;
    };
    handle('capture:session', (event) => captureFor(event).job);
    handle('capture:chunk', async (event, bytes: ArrayBuffer) => {
      const capture = captureFor(event);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 64 * 1024 * 1024)
        throw new Error('Invalid capture chunk.');
      await fs.appendFile(capture.raw, Buffer.from(bytes));
      capture.bytes += bytes.byteLength;
    });
    handle('capture:ready', (event) => {
      const capture = captureFor(event);
      const display = screen.getAllDisplays().find((d) => d.id === capture.displayId);
      if (display) showRecordingControls(display, capture.job.rect);
      cursorRecorder?.begin();
      send('recording', true);
    });
    handle('capture:finish', async (event, error?: string) => {
      const capture = captureFor(event);
      controls?.close();
      controls = null;
      try {
        if (error || !capture.bytes) throw new Error(error || 'No frames were captured.');
        if (capture.job.mode === 'record') {
          await run(ffmpeg, [
            '-v',
            'error',
            '-y',
            '-i',
            capture.raw,
            '-vf',
            'pad=ceil(iw/2)*2:ceil(ih/2)*2',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            capture.output,
          ]);
          await fs.rm(capture.raw, { force: true });
        }
        await rememberOutput(capture.output);
        const media = await inspect(capture.output);
        if (cursorRecorder)
          media.cursor = await cursorRecorder.finish(capture.output, media.duration);
        cursorRecorder = undefined;
        send('media', media);
      } catch (failure) {
        report(
          new Error(
            `${failure instanceof Error ? failure.message : String(failure)}${capture.bytes ? `\nSaved capture data: ${capture.raw}` : ''}`,
          ),
        );
      } finally {
        browserCapture = null;
        cursorRecorder?.stop();
        cursorRecorder = undefined;
        capture.window.close();
        send('recording', false);
        main.show();
      }
    });
    handle('tray:action', async (_, action: string) => {
      if (action === 'dismiss') quickTray.hide();
      else if (action === 'open') {
        quickTray.hide();
        showStudio();
      } else if (action === 'capture') {
        quickTray.hide();
        await openPicker();
      } else if (action === 'folder') {
        await fs.mkdir(settings.folder, { recursive: true });
        const error = await shell.openPath(settings.folder);
        if (error) throw new Error(error);
        quickTray.hide();
      } else if (action === 'copy') {
        const file = settings.lastSavedFile || settings.lastFile;
        if (!file) throw new Error('No saved file yet.');
        await fs.access(file);
        outputFiles.add(file);
        await performFileAction('copy', file);
      } else if (action === 'quit') {
        quickTray.hide();
        showStudio();
        main.close();
      }
    });
    handle('window:action', (_, action: string) => {
      if (action === 'minimize') settings.minimizeToTray ? minimizeStudio() : main.minimize();
      if (action === 'maximize') main.isMaximized() ? main.unmaximize() : main.maximize();
      if (action === 'close') main.close();
      if (process.platform === 'darwin' && (action === 'preview-fullscreen' || action === 'preview-windowed')) main.setSimpleFullScreen(action === 'preview-fullscreen');
    });
    handle('export:start', async (_, input: ExportRequest) => {
      if (exporting) throw new Error('An export is already running.');
      const media = mediaStore.get(input.mediaId);
      if (!media) throw new Error('Import media first.');
      const formats =
        media.kind === 'image' ? ['png', 'jpg', 'webp'] : ['mp4', 'mov', 'webm', 'gif'];
      if (!formats.includes(input.format)) throw new Error('Unsupported export format.');
      const c = composition(input.composition, media);
      for (const bytes of [input.background, input.mask])
        if (!bytes || bytes.byteLength > 64 * 1024 * 1024) throw new Error('Invalid render image.');
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cutter-export-'));
      const output = await outputPath('Cutter', input.format);
      const bg = path.join(temp, 'background.png'),
        mask = path.join(temp, 'mask.png');
      try {
        await fs.writeFile(bg, Buffer.from(input.background));
        await fs.writeFile(mask, Buffer.from(input.mask));
        let overlay: string | undefined;
        if (input.cursor && media.cursor && (input.cursor.visible || input.cursor.clicksVisible)) {
          overlay = path.join(temp, 'cursor.mov');
          await renderCursorOverlay(
            ffmpeg,
            overlay,
            media,
            c,
            input.composition,
            validateTrack(input.cursor),
            (child) => {
              exporting = child;
            },
          );
        }
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            ffmpeg,
            exportArgs(media, c, input.format, bg, mask, output, overlay),
            {
              windowsHide: true,
            },
          );
          exporting = child;
          let errors = '',
            progress = '';
          child.stdout.on('data', (d) => {
            progress += d;
            const lines = progress.split('\n');
            progress = lines.pop() || '';
            for (const line of lines) {
              const match = line.match(/^out_time_us=(\d+)/);
              if (match)
                send(
                  'export-progress',
                  Math.min(99, (Number(match[1]) / 1000000 / (c.end - c.start || 1)) * 100),
                );
            }
          });
          child.stderr.on('data', (d) => {
            errors = (errors + d).slice(-5000);
          });
          child.on('error', reject);
          child.on('close', (code) =>
            code === 0
              ? resolve()
              : reject(
                  new Error(
                    exporting?.cancelled ? 'Export cancelled.' : errors || 'Export failed.',
                  ),
                ),
          );
        });
        await rememberOutput(output);
        return { path: output, name: path.basename(output) };
      } catch (e) {
        await fs.rm(output, { force: true });
        throw e;
      } finally {
        exporting = null;
        await fs.rm(temp, { recursive: true, force: true });
      }
    });
    handle('export:cancel', () => {
      if (exporting) {
        exporting.cancelled = true;
        exporting.kill();
      }
    });
    handle('file:action', (_, action: string, file: string) => performFileAction(action, file));
  })
  .catch((e) => {
    console.error(e);
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (main && !main.isDestroyed()) showStudio();
});
app.on('will-quit', () => {
  quickTray.destroy();
  globalShortcut.unregisterAll();
  cursorRecorder?.stop();
  nativeRecording?.child.kill();
  recording?.child.kill();
  exporting?.kill();
  browserCapture?.window.destroy();
});
