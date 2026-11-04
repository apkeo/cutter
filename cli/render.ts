import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { validateTrack } from '../electron/cursor';
import { exportMedia } from '../electron/export';
import { probeMedia } from '../electron/media';
import { composition as normalize } from '../electron/model';
import { fitCorners } from '../shared/crop';
import type { CursorTrack } from '../shared/cursor';
import type { Composition, Media, Rect, RenderComposition } from '../shared/types';

export const PRESETS = {
  clean: { padding: 0, radius: 0, background: '#000000' },
  framed: { padding: 64, radius: 24, background: '#d7e3d1' },
} as const;
export type PresetName = keyof typeof PRESETS;

export interface RenderOptions {
  input: string;
  output: string;
  preset: PresetName;
  overrides: Partial<Composition>;
  maxWidth?: number;
  cursorFile?: string;
  noCursor: boolean;
  cursor: { size?: number; smooth?: boolean };
}

const FORMATS: Record<string, { kind: Media['kind']; format: string }> = {
  '.png': { kind: 'image', format: 'png' },
  '.jpg': { kind: 'image', format: 'jpg' },
  '.jpeg': { kind: 'image', format: 'jpg' },
  '.webp': { kind: 'image', format: 'webp' },
  '.mp4': { kind: 'video', format: 'mp4' },
  '.mov': { kind: 'video', format: 'mov' },
  '.webm': { kind: 'video', format: 'webm' },
  '.gif': { kind: 'video', format: 'gif' },
};

export function outputFormat(output: string, kind: Media['kind']) {
  const match = FORMATS[path.extname(output).toLowerCase()];
  if (!match) throw new Error(`Unsupported output format: ${path.extname(output) || output}`);
  if (match.kind !== kind)
    throw new Error(`A ${kind} input cannot be rendered to ${path.extname(output)}.`);
  return match.format;
}

export function buildComposition(
  media: Pick<Media, 'width' | 'height' | 'fps' | 'duration' | 'kind'>,
  preset: PresetName,
  overrides: Partial<Composition>,
  maxWidth?: number,
): Composition {
  const crop: Rect = overrides.crop ?? { x: 0, y: 0, width: media.width, height: media.height };
  const padding = overrides.padding ?? PRESETS[preset].padding;
  const available = maxWidth === undefined ? crop.width : maxWidth - 2 * padding;
  const fit = Math.min(1, available / crop.width);
  const radius = overrides.radius ?? PRESETS[preset].radius;
  return {
    width: overrides.width ?? Math.round(crop.width * fit) + 2 * padding,
    height: overrides.height ?? Math.round(crop.height * fit) + 2 * padding,
    padding,
    radius,
    radii: overrides.radii ?? [radius, radius, radius, radius],
    background: overrides.background ?? PRESETS[preset].background,
    muted: overrides.muted ?? false,
    fps: overrides.fps ?? (media.kind === 'video' ? media.fps : 30),
    crop,
    start: overrides.start ?? 0,
    end: overrides.end ?? media.duration,
  };
}

export function drawPlates(c: RenderComposition, input: Composition) {
  const background = createCanvas(c.width, c.height);
  const backgroundContext = background.getContext('2d');
  backgroundContext.fillStyle = c.background;
  backgroundContext.fillRect(0, 0, c.width, c.height);
  const mask = createCanvas(c.drawWidth, c.drawHeight);
  const maskContext = mask.getContext('2d');
  maskContext.fillStyle = '#000';
  maskContext.fillRect(0, 0, c.drawWidth, c.drawHeight);
  maskContext.fillStyle = '#fff';
  maskContext.beginPath();
  maskContext.roundRect(
    0,
    0,
    c.drawWidth,
    c.drawHeight,
    fitCorners(
      input.radii ?? [input.radius, input.radius, input.radius, input.radius],
      c.drawWidth,
      c.drawHeight,
    ),
  );
  maskContext.fill();
  return { background: background.toBuffer('image/png'), mask: mask.toBuffer('image/png') };
}

async function loadCursor(options: RenderOptions, media: Media): Promise<CursorTrack | undefined> {
  if (options.noCursor) return undefined;
  let track = media.cursor;
  if (options.cursorFile) {
    const sidecar = JSON.parse(await fs.readFile(options.cursorFile, 'utf8'));
    track = validateTrack(sidecar.edited ?? sidecar);
  }
  if (!track) return undefined;
  return {
    ...track,
    size: options.cursor.size ?? track.size,
    smooth: options.cursor.smooth ?? track.smooth,
  };
}

export async function render(
  options: RenderOptions,
  binaries: { ffmpeg: string; ffprobe: string },
  onProgress?: (percent: number) => void,
) {
  const { media } = await probeMedia(options.input, binaries.ffprobe);
  const format = outputFormat(options.output, media.kind);
  const input = buildComposition(media, options.preset, options.overrides, options.maxWidth);
  const { background, mask } = drawPlates(normalize(input, media), input);
  const cursor = await loadCursor(options, media);
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  try {
    await exportMedia({
      ffmpeg: binaries.ffmpeg,
      media,
      composition: input,
      format,
      background,
      mask,
      cursor,
      output: options.output,
      onProgress,
    });
  } catch (error) {
    await fs.rm(options.output, { force: true });
    throw error;
  }
  const { media: result } = await probeMedia(options.output, binaries.ffprobe);
  return {
    path: options.output,
    format,
    width: result.width,
    height: result.height,
    seconds: Number(result.duration.toFixed(2)),
    size: result.size,
    cursor: Boolean(cursor),
  };
}
