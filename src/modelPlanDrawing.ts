export type ModelPlanDrawing = { outlines: Float32Array[]; lines: Float32Array[] }

function simplify(points: number[], width: number, height: number) {
  const count = points.length / 2, keep = new Uint8Array(count), work = [[0, count - 1]]
  keep[0] = keep[count - 1] = 1
  while (work.length) {
    const [start, end] = work.pop()!, ax = points[start * 2], ay = points[start * 2 + 1]
    const dx = points[end * 2] - ax, dy = points[end * 2 + 1] - ay, length = dx * dx + dy * dy
    let best = .7 * .7, split = -1
    for (let i = start + 1; i < end; i++) {
      const px = points[i * 2] - ax, py = points[i * 2 + 1] - ay
      const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0
      const distance = (px - t * dx) ** 2 + (py - t * dy) ** 2
      if (distance > best) { best = distance; split = i }
    }
    if (split >= 0) { keep[split] = 1; work.push([start, split], [split, end]) }
  }
  const result: number[] = []
  for (let i = 0; i < count; i++) if (keep[i]) result.push(points[i * 2] / width, points[i * 2 + 1] / height)
  return new Float32Array(result)
}

/** Runs in a worker once per asset. The resulting paths are drawn with fixed
 * screen-space strokes, so plan zoom never resamples a thin raster outline. */
export function createModelPlanDrawing(pixels: Uint8ClampedArray, width: number, height: number): ModelPlanDrawing {
  const total = width * height, solid = new Uint8Array(total), ink = new Uint8Array(total)
  for (let i = 0; i < total; i++) solid[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x]
  const borders = new Map<number, number[]>()
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * (width + 1) + ax, b = by * (width + 1) + bx
    const next = borders.get(a) ?? []; next.push(b); borders.set(a, next)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (!solid[i]) continue
    if (!inside(x, y - 1)) edge(x, y, x + 1, y)
    if (!inside(x + 1, y)) edge(x + 1, y, x + 1, y + 1)
    if (!inside(x, y + 1)) edge(x + 1, y + 1, x, y + 1)
    if (!inside(x - 1, y)) edge(x, y + 1, x, y)
    // The silhouette already has its own vector stroke. Keep only interior
    // ink here, avoiding a second parallel outline around the whole object.
    if (pixels[i * 4] < 128 && inside(x - 3, y) && inside(x + 3, y) && inside(x, y - 3) && inside(x, y + 3)) ink[i] = 1
  }
  const outlines: Float32Array[] = []
  for (const [start, next] of borders) while (next.length) {
    const points: number[] = [], stride = width + 1
    let current = start
    do {
      points.push(current % stride, Math.floor(current / stride))
      const following = borders.get(current)?.pop()
      if (following === undefined) break
      current = following
    } while (current !== start)
    points.push(start % stride, Math.floor(start / stride))
    if (points.length >= 8) outlines.push(simplify(points, width, height))
  }
  // Thin the detected interior edges to single centre lines (Zhang-Suen).
  // Their eventual thickness belongs to Konva, independent of preview pixels.
  const offsets = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1]
  for (let iteration = 0; iteration < 64; iteration++) {
    let changed = false
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = []
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (!ink[i]) continue
        const n = offsets.map(offset => ink[i + offset]), neighbours = n.reduce((sum, v) => sum + v, 0)
        if (neighbours < 2 || neighbours > 6) continue
        let changes = 0
        for (let j = 0; j < 8; j++) if (!n[j] && n[(j + 1) % 8]) changes++
        if (changes !== 1) continue
        if (pass === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue
        remove.push(i)
      }
      if (remove.length) changed = true
      for (const i of remove) ink[i] = 0
    }
    if (!changed) break
  }
  const neighbours = (i: number) => offsets.map(offset => i + offset).filter(j =>
    j >= 0 && j < total && ink[j] && Math.abs(j % width - i % width) <= 1 &&
    // Avoid diagonal shortcuts across an existing right-angle joint.
    (!(j % width !== i % width && Math.floor(j / width) !== Math.floor(i / width)) ||
      (!ink[Math.floor(i / width) * width + j % width] && !ink[Math.floor(j / width) * width + i % width])))
  const nodes = new Map<number, number[]>()
  for (let i = 0; i < total; i++) if (ink[i]) nodes.set(i, neighbours(i))
  const used = new Set<number>(), lines: Float32Array[] = []
  const key = (a: number, b: number) => Math.min(a, b) * total + Math.max(a, b)
  const walk = (start: number, next: number) => {
    const points = [start % width + .5, Math.floor(start / width) + .5]
    let previous = start, current = next
    while (!used.has(key(previous, current))) {
      used.add(key(previous, current))
      points.push(current % width + .5, Math.floor(current / width) + .5)
      const adjacent = nodes.get(current)!
      if (adjacent.length !== 2 || current === start) break
      const following = adjacent.find(n => n !== previous)!
      previous = current; current = following
    }
    if (points.length >= 6) lines.push(simplify(points, width, height))
  }
  for (const [i, adjacent] of nodes) if (adjacent.length !== 2) for (const next of adjacent) if (!used.has(key(i, next))) walk(i, next)
  for (const [i, adjacent] of nodes) for (const next of adjacent) if (!used.has(key(i, next))) walk(i, next)
  return { outlines, lines }
}
