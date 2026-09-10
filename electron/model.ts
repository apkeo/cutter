import path from 'node:path';
import type { Media, Composition, RenderComposition } from '../shared/types';
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif']);
export const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'gif']);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
function number(v: unknown, min: number, max: number, fallback: number) {
  return clamp(Number.isFinite(Number(v)) ? Number(v) : fallback, min, max);
}
export function classify(file: string): Media['kind'] {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  throw new Error(
    'Unsupported file. Use PNG, JPEG, WebP, BMP, TIFF, AVIF, MP4, MOV, WebM, MKV, AVI or GIF.',
  );
}
export function composition(
  input: Partial<Composition>,
  media: Pick<Media, 'width' | 'height' | 'duration' | 'fps'>,
): RenderComposition {
  const width = Math.round(number(input.width, 16, 7680, 1920));
  const height = Math.round(number(input.height, 16, 7680, 1080));
  const x = Math.round(number(input.crop?.x, 0, media.width - 1, 0));
  const y = Math.round(number(input.crop?.y, 0, media.height - 1, 0));
  const crop = {
    x,
    y,
    width: Math.round(number(input.crop?.width, 1, media.width - x, media.width)),
    height: Math.round(number(input.crop?.height, 1, media.height - y, media.height)),
  };
  const padding = number(input.padding, 0, Math.min(width, height) / 2 - 1, 64);
  const scale = Math.min((width - 2 * padding) / crop.width, (height - 2 * padding) / crop.height);
  const drawWidth = Math.max(1, Math.round(crop.width * scale));
  const drawHeight = Math.max(1, Math.round(crop.height * scale));
  const start = number(input.start, 0, Math.max(0, media.duration - 0.01), 0);
  const end = number(
    input.end,
    start + 0.01,
    Math.max(start + 0.01, media.duration),
    media.duration,
  );
  return {
    muted: input.muted === true,
    width,
    height,
    crop,
    padding,
    drawWidth,
    drawHeight,
    radius: number(input.radius, 0, Math.min(drawWidth, drawHeight) / 2, 8),
    background: /^#[\da-f]{6}$/i.test(input.background || '') ? input.background! : '#d7e3d1',
    fps: number(input.fps, 1, Math.max(1, media.fps || 30), 30),
    start,
    end,
  };
}
export function exportArgs(
  media: Media,
  c: RenderComposition,
  format: string,
  background: string,
  mask: string,
  output: string,
  cursorOverlay?: string,
) {
  const isImage = media.kind === 'image';
  const args = ['-hide_banner', '-y', '-threads', '2'];
  if (!isImage) args.push('-ss', String(c.start), '-t', String(c.end - c.start));
  if (isImage) args.push('-loop', '1');
  args.push(
    '-i',
    media.path,
    '-loop',
    '1',
    '-framerate',
    String(c.fps),
    '-i',
    background,
    '-loop',
    '1',
    '-framerate',
    String(c.fps),
    '-i',
    mask,
  );
  if (cursorOverlay) args.push('-i', cursorOverlay);
  let filter = `[0:v]crop=${c.crop.width}:${c.crop.height}:${c.crop.x}:${c.crop.y},scale=${c.drawWidth}:${c.drawHeight}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS,format=rgba[clip];[2:v]format=gray[mask];[clip][mask]alphamerge=shortest=1[rounded];[1:v]format=rgba[bg];[bg][rounded]overlay=(W-w)/2:(H-h)/2:shortest=1:format=rgb,setsar=1`;
  if (cursorOverlay) filter += '[base];[base][3:v]overlay=0:0:shortest=1:format=rgb';
  if (!isImage) filter += `,fps=${c.fps}`;
  if (['mp4', 'mov', 'webm'].includes(format)) filter += ',pad=ceil(iw/2)*2:ceil(ih/2)*2';
  if (format === 'gif') filter += ',split[g1][g2];[g1]palettegen[p];[g2][p]paletteuse';
  filter += '[out]';
  args.push('-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[out]');
  if (isImage) args.push('-frames:v', '1');
  else args.push('-t', String(c.end - c.start));
  if (['mp4', 'mov'].includes(format))
    args.push(
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
    );
  if (format === 'webm')
    args.push('-map', '0:a?', '-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-c:a', 'libopus');
  if (c.muted) {
    const audioMap = args.indexOf('0:a?');
    if (audioMap !== -1) args.splice(audioMap - 1, 2);
    args.push('-an');
  }
  if (format === 'jpg') args.push('-q:v', '2');
  if (format === 'webp') args.push('-c:v', 'libwebp', '-quality', '95');
  args.push('-progress', 'pipe:1', output);
  return args;
}
