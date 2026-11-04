import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateTrack } from './cursor';
import { classify } from './model';
import type { Media } from '../shared/types';

export function run(
  binary: string,
  args: string[],
  onProgress?: (text: string) => void,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, env, cwd });
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

export async function probeMedia(file: string, ffprobe: string) {
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
  return { media, codec: video.codec_name, modifiedMs: stat.mtimeMs };
}
