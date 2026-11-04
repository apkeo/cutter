export interface TimedFrame {
  timestamp: number;
  arrived: number;
}
export interface PlacedFrame {
  index: number;
  duration: number;
}

export function placeFrames(frames: TimedFrame[], started: number, stopped: number): PlacedFrame[] {
  if (!frames.length) return [];
  const clockOffset = Math.min(...frames.map((frame) => frame.arrived - frame.timestamp));
  const times = frames.map((frame) => frame.timestamp + clockOffset);
  let first = 0;
  times.forEach((time, index) => {
    if (time <= started) first = index;
  });
  const placed: PlacedFrame[] = [];
  for (let index = first; index < frames.length; index++) {
    const from = Math.max(times[index], started);
    if (from >= stopped) break;
    const until = Math.min(index + 1 < frames.length ? times[index + 1] : stopped, stopped);
    if (until > from) placed.push({ index, duration: until - from });
  }
  return placed;
}

export function motionFps(placed: PlacedFrame[]) {
  const moving = placed
    .slice(0, -1)
    .map((frame) => frame.duration)
    .filter((duration) => duration < 0.25)
    .sort((a, b) => a - b);
  if (!moving.length) return 0;
  return Number((1 / moving[Math.floor(moving.length / 2)]).toFixed(1));
}

export function concatList(placed: PlacedFrame[], fileName: (index: number) => string) {
  const lines: string[] = [];
  for (const frame of placed)
    lines.push(`file '${fileName(frame.index)}'`, `duration ${frame.duration.toFixed(4)}`);
  if (placed.length) lines.push(`file '${fileName(placed[placed.length - 1].index)}'`);
  return lines.join('\n');
}
