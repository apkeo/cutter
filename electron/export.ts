import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderCursorOverlay } from './cursor-render';
import { composition, exportArgs } from './model';
import type { CursorTrack } from '../shared/cursor';
import type { Composition, Media } from '../shared/types';

export interface ExportJob {
  ffmpeg: string;
  media: Media;
  composition: Composition;
  format: string;
  background: ArrayBuffer | Uint8Array;
  mask: ArrayBuffer | Uint8Array;
  cursor?: CursorTrack;
  output: string;
  onChild?: (child: ChildProcessWithoutNullStreams) => void;
  onProgress?: (percent: number) => void;
}

export async function exportMedia(job: ExportJob) {
  const c = composition(job.composition, job.media);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cutter-export-'));
  const bg = path.join(temp, 'background.png'),
    mask = path.join(temp, 'mask.png');
  try {
    await fs.writeFile(bg, Buffer.from(job.background as ArrayBuffer));
    await fs.writeFile(mask, Buffer.from(job.mask as ArrayBuffer));
    let overlay: string | undefined;
    if (job.cursor && (job.cursor.visible || job.cursor.clicksVisible)) {
      overlay = path.join(temp, 'cursor.mov');
      await renderCursorOverlay(
        job.ffmpeg,
        overlay,
        job.media,
        c,
        job.composition,
        job.cursor,
        (child) => job.onChild?.(child),
      );
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        job.ffmpeg,
        exportArgs(job.media, c, job.format, bg, mask, job.output, overlay),
        {
          windowsHide: true,
        },
      );
      job.onChild?.(child);
      let errors = '',
        progress = '';
      child.stdout.on('data', (d) => {
        progress += d;
        const lines = progress.split('\n');
        progress = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^out_time_us=(\d+)/);
          if (match)
            job.onProgress?.(
              Math.min(99, (Number(match[1]) / 1000000 / (c.end - c.start || 1)) * 100),
            );
        }
      });
      child.stderr.on('data', (d) => {
        errors = (errors + d).slice(-5000);
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(errors || 'Export failed.')),
      );
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
