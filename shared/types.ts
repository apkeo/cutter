export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Composition {
  width: number;
  height: number;
  padding: number;
  radius: number;
  background: string;
  muted: boolean;
  fps: number;
  crop: Rect;
  start: number;
  end: number;
}
export interface Settings {
  shortcut: string;
  folder: string;
  language: 'en' | 'pl';
  captureFps: number;
  cursor: boolean;
  editor: Composition;
  lastFile?: string;
  region?: Rect & { displayId: number };
}
export interface Media {
  id: string;
  path: string;
  name: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  fps: number;
  duration: number;
  size: number;
  hasAudio: boolean;
  url: string;
}
export interface RenderComposition extends Composition {
  drawWidth: number;
  drawHeight: number;
}
export interface ExportRequest {
  mediaId: string;
  composition: Composition;
  format: string;
  background: ArrayBuffer;
  mask: ArrayBuffer;
}
export interface ExportResult {
  path: string;
  name: string;
}
export interface Events {
  media: Media;
  status: string;
  'export-progress': number;
  recording: boolean;
  error: string;
  'capture-stop': undefined;
  'picker-region': Rect;
}
export interface CaptureSession {
  rect: Rect;
  display: { width: number; height: number };
  fps: number;
  cursor: boolean;
  mode: 'screenshot' | 'record';
}
export interface CutterAPI {
  platform: string;
  settings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  chooseFolder(): Promise<string>;
  open(): Promise<Media | undefined>;
  importFile(file: string): Promise<Media>;
  filePath(file: File): string;
  picker(): Promise<void>;
  movePicker(rect: Rect | null): Promise<void>;
  pickerInit(): Promise<{
    settings: Settings;
    display: { id: number; bounds: Rect; scaleFactor: number };
  }>;
  capture(data: { rect: Rect; mode: 'screenshot' | 'record' }): Promise<void>;
  stop(): Promise<void>;
  cancelPicker(): Promise<void>;
  captureSession(): Promise<CaptureSession>;
  captureChunk(bytes: ArrayBuffer): Promise<void>;
  captureReady(): Promise<void>;
  captureFinish(error?: string): Promise<void>;
  export(request: ExportRequest): Promise<ExportResult>;
  cancelExport(): Promise<void>;
  fileAction(action: 'path' | 'copy' | 'reveal', file: string): Promise<boolean>;
  window(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  on<K extends keyof Events>(channel: K, callback: (data: Events[K]) => void): () => void;
}
declare global {
  interface Window {
    cutter: CutterAPI;
  }
}
