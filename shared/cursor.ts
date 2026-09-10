import {
  faArrowPointer,
  faICursor,
  faHandPointer,
  faComputerMouse,
} from '@fortawesome/free-solid-svg-icons';
export type CursorShape = 'arrow' | 'text' | 'hand';
export interface CursorSample {
  t: number;
  x: number;
  y: number;
  shape: CursorShape;
}
export interface CursorClick {
  id: string;
  t: number;
  end: number;
  button: 'left' | 'right' | 'middle';
  x: number;
  y: number;
}
export interface CursorTrack {
  version: 1;
  nativeVisible: boolean;
  visible: boolean;
  clicksVisible: boolean;
  smooth: boolean;
  size: number;
  samples: CursorSample[];
  clicks: CursorClick[];
}
export const cursorIcons = {
  arrow: faArrowPointer,
  text: faICursor,
  hand: faHandPointer,
  mouse: faComputerMouse,
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export function sampleAt(samples: CursorSample[], t: number): CursorSample | undefined {
  if (!samples.length) return;
  let low = 0,
    high = samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (samples[mid].t <= t) low = mid;
    else high = mid - 1;
  }
  const a = samples[low],
    b = samples[Math.min(low + 1, samples.length - 1)];
  const f = clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, shape: a.shape };
}
export function smoothPoints(track: CursorTrack): CursorSample[] {
  const source = track.samples;
  if (!source.length) return [];
  const points: CursorSample[] = [];
  // Average small hand tremors, retaining explicit click anchors at their exact positions.
  for (let t = source[0].t; t < source[source.length - 1].t; t += 0.12) {
    let x = 0,
      y = 0,
      weight = 0;
    for (let d = -0.06; d <= 0.061; d += 0.02) {
      const p = sampleAt(source, t + d)!;
      const w = 1 - Math.abs(d) / 0.08;
      x += p.x * w;
      y += p.y * w;
      weight += w;
    }
    points.push({ ...sampleAt(source, t)!, x: x / weight, y: y / weight });
  }
  points.push({ ...source[source.length - 1] });
  for (const c of track.clicks) {
    for (let i = points.length - 1; i >= 0; i--)
      if (Math.abs(points[i].t - c.t) < 0.04) points.splice(i, 1);
    points.push({ ...sampleAt(source, c.t)!, t: c.t, x: c.x, y: c.y });
  }
  return points.sort((a, b) => a.t - b.t);
}
export function cursorAt(
  track: CursorTrack,
  t: number,
  smooth = track.smooth ? smoothPoints(track) : undefined,
): CursorSample | undefined {
  const original = sampleAt(track.samples, t);
  if (!original || !smooth?.length) return original;
  let i = 0;
  while (i < smooth.length - 2 && smooth[i + 1].t < t) i++;
  const a = smooth[i],
    b = smooth[Math.min(i + 1, smooth.length - 1)],
    before = smooth[Math.max(0, i - 1)],
    after = smooth[Math.min(smooth.length - 1, i + 2)];
  const duration = b.t - a.t,
    f = clamp((t - a.t) / (duration || 1), 0, 1);
  const interpolate = (axis: 'x' | 'y') => {
    const v0 = ((b[axis] - before[axis]) / (b.t - before.t || 1)) * duration,
      v1 = ((after[axis] - a[axis]) / (after.t - a.t || 1)) * duration;
    return clamp(
      (2 * f * f * f - 3 * f * f + 1) * a[axis] +
        (f * f * f - 2 * f * f + f) * v0 +
        (-2 * f * f * f + 3 * f * f) * b[axis] +
        (f * f * f - f * f) * v1,
      Math.min(a[axis], b[axis]),
      Math.max(a[axis], b[axis]),
    );
  };
  return { ...original, x: interpolate('x'), y: interpolate('y') };
}

export function drawCursor(
  ctx: CanvasRenderingContext2D,
  track: CursorTrack,
  t: number,
  width: number,
  height: number,
  makePath: (d: string) => Path2D = (d) => new Path2D(d),
  points?: CursorSample[],
) {
  if (!track.visible && !track.clicksVisible) return;
  const pose = cursorAt(track, t, points);
  if (!pose) return;
  const x = pose.x * width,
    y = pose.y * height,
    size = track.size;
  ctx.save();
  if (track.clicksVisible)
    for (const click of track.clicks) {
      const age = t - click.t;
      if (age < 0 || age > 0.45) continue;
      const progress = age / 0.45;
      ctx.globalAlpha = (1 - progress) * (1 - progress);
      ctx.strokeStyle = '#c0f28c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(
        click.x * width,
        click.y * height,
        4 + size * 1.2 * (1 - Math.pow(1 - progress, 3)),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  ctx.globalAlpha = 1;
  const icon = (
    shape: CursorShape | 'mouse',
    px: number,
    py: number,
    scaleSize: number,
    fill: string,
  ) => {
    const [w, h, , , data] = cursorIcons[shape].icon;
    const hotspot =
      shape === 'arrow'
        ? [64, 0]
        : shape === 'hand'
          ? [168, 0]
          : shape === 'text'
            ? [128, 256]
            : [0, 0];
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(scaleSize / Number(h), scaleSize / Number(h));
    ctx.translate(-hotspot[0], -hotspot[1]);
    const path = makePath(Array.isArray(data) ? data.join(' ') : data);
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#14200fff';
    ctx.lineWidth = (Number(h) / scaleSize) * 2;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.fill(path);
    ctx.restore();
  };
  if (track.visible) icon(pose.shape, x, y, size, '#ffffff');
  if (track.clicksVisible) {
    const bx = x + size * 0.85,
      by = y + size * 0.85,
      bs = size * 0.65;
    icon('mouse', bx, by, bs, '#ffffff');
    const held = track.clicks.filter((c) => t >= c.t && t < c.end);
    ctx.fillStyle = '#baf285';
    for (const click of held) {
      if (click.button === 'middle')
        ctx.fillRect(bx + bs * 0.32, by + bs * 0.1, bs * 0.12, bs * 0.23);
      else
        ctx.fillRect(
          bx + (click.button === 'left' ? 0.06 : 0.44) * bs,
          by + 0.08 * bs,
          0.25 * bs,
          0.25 * bs,
        );
    }
  }
  ctx.restore();
}
