import { createCanvas, Path2D } from '@napi-rs/canvas';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { drawCursor, smoothPoints, type CursorTrack } from '../shared/cursor';
import { fitCorners } from '../shared/crop';
import type { Media, RenderComposition, Composition } from '../shared/types';

export async function renderCursorOverlay(
  ffmpeg: string,
  output: string,
  media: Media,
  c: RenderComposition,
  input: Composition,
  track: CursorTrack,
  started: (child: ChildProcessWithoutNullStreams) => void,
) {
  const canvas = createCanvas(c.width, c.height),
    ctx = canvas.getContext('2d');
  const child = spawn(
    ffmpeg,
    [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgba',
      '-video_size',
      `${c.width}x${c.height}`,
      '-framerate',
      String(c.fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'qtrle',
      '-pix_fmt',
      'argb',
      output,
    ],
    { windowsHide: true },
  );
  started(child);
  child.stdin.on('error', () => {});
  let errors = '';
  child.stderr.on('data', (d) => (errors = (errors + d).slice(-2000)));
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(errors || 'Cursor render cancelled.')),
    );
  });
  // Attach immediately: a failed encoder may exit before the next frame is ready.
  void done.catch(() => {});
  const points = track.smooth ? smoothPoints(track) : undefined;
  const radii = fitCorners(
    input.radii || [input.radius, input.radius, input.radius, input.radius],
    c.drawWidth,
    c.drawHeight,
  );
  try {
    const frames = Math.max(1, Math.ceil((c.end - c.start) * c.fps));
    for (let frame = 0; frame < frames; frame++) {
      if (child.killed || child.exitCode !== null) throw new Error('Cursor render cancelled.');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.beginPath();
      const x = (c.width - c.drawWidth) / 2,
        y = (c.height - c.drawHeight) / 2;
      ctx.roundRect(x, y, c.drawWidth, c.drawHeight, radii);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(c.drawWidth / c.crop.width, c.drawHeight / c.crop.height);
      ctx.translate(-c.crop.x, -c.crop.y);
      drawCursor(
        ctx as unknown as CanvasRenderingContext2D,
        track,
        c.start + frame / c.fps,
        media.width,
        media.height,
        (d) => new Path2D(d) as unknown as globalThis.Path2D,
        points,
      );
      ctx.restore();
      if (!child.stdin.write(Buffer.from(ctx.getImageData(0, 0, c.width, c.height).data)))
        await once(child.stdin, 'drain');
    }
    child.stdin.end();
    await done;
  } catch (error) {
    child.kill();
    throw error;
  }
}
