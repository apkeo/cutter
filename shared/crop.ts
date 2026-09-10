export type Corners = [number, number, number, number];

export function scaleCorners(
  values: Corners,
  index: number,
  value: number,
  linked: boolean,
): Corners {
  const next = Math.max(0, Math.min(2000, Number(value) || 0));
  const previous = values[index];
  // A zero corner has no ratio: use an additive change until it becomes nonzero.
  return values.map((v, i) =>
    i === index
      ? next
      : linked
        ? Math.max(0, Math.min(2000, previous > 0 ? (v * next) / previous : v + next))
        : v,
  ) as Corners;
}

export function fitCorners(values: Corners, width: number, height: number): Corners {
  const [tl, tr, br, bl] = values;
  const scale = Math.min(
    1,
    width / (tl + tr || 1),
    width / (bl + br || 1),
    height / (tl + bl || 1),
    height / (tr + br || 1),
  );
  return values.map((v) => v * scale) as Corners;
}

// Compare adjacent pixels along the moving edge. Sampling along (not across)
// the edge bounds work while keeping the snap coordinate at source-pixel precision.
export function findEdge(
  image: ImageData,
  axis: 'x' | 'y',
  value: number,
  from: number,
  to: number,
  tolerance: number,
): number | undefined {
  const limit = axis === 'x' ? image.width : image.height;
  const length = axis === 'x' ? image.height : image.width;
  let best: number | undefined,
    bestScore = 0;
  const start = Math.max(0, Math.floor(from)),
    end = Math.min(length, Math.ceil(to));
  for (
    let at = Math.max(0, Math.ceil(value - tolerance));
    at <= Math.min(limit, Math.floor(value + tolerance));
    at++
  ) {
    let contrast = 0,
      samples = 0;
    if (at === 0 || at === limit) contrast = 255;
    else {
      for (let along = start; along < end; along += Math.max(1, Math.floor((end - start) / 160))) {
        const offset =
          axis === 'x' ? (along * image.width + at) * 4 : (at * image.width + along) * 4;
        const prior = offset - (axis === 'x' ? 4 : image.width * 4);
        contrast +=
          (Math.abs(image.data[offset] - image.data[prior]) +
            Math.abs(image.data[offset + 1] - image.data[prior + 1]) +
            Math.abs(image.data[offset + 2] - image.data[prior + 2])) /
          3;
        samples++;
      }
      contrast /= samples || 1;
    }
    const score = contrast / (1 + Math.abs(at - value) * 0.15);
    if (contrast >= 28 && score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
}
