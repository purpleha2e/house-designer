export type ColorPickCandidate<T> = {
  colorId: number
  pixel: [number, number, number, number]
  target: T
}

export function pickTargetFromColorBuffer<T>({
  centerX,
  centerY,
  getPriority,
  height,
  pixels,
  targetByColorId,
  width,
}: {
  centerX: number
  centerY: number
  getPriority: (target: T) => number
  height: number
  pixels: Uint8Array
  targetByColorId: ReadonlyMap<number, T>
  width: number
}): ColorPickCandidate<T> | null {
  const candidateAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4
    const pixel: [number, number, number, number] = [
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      pixels[offset + 3],
    ]
    const colorId = pixel[0] * 65536 + pixel[1] * 256 + pixel[2]
    const target = targetByColorId.get(colorId)
    return target ? { colorId, pixel, target } : null
  }
  const center = candidateAt(centerX, centerY)

  // Models, roofs, walls and slab edges should remain exact when the center
  // pixel already hits one. Floors and ceilings are broad background targets,
  // so a nearby thin object is more useful than the center background pixel.
  if (center && getPriority(center.target) >= 2) return center

  let best: (ColorPickCandidate<T> & { distanceSquared: number; priority: number }) | null = null
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const candidate = candidateAt(x, y)
      if (!candidate) continue
      const priority = getPriority(candidate.target)
      // A broad floor or ceiling is useful only when it is directly beneath
      // the pointer. Do not turn a center miss into a nearby background hit;
      // callers need that miss to run their geometry fallback.
      if (!center && priority <= 0) continue
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2
      if (!best || priority > best.priority ||
        (priority === best.priority && distanceSquared < best.distanceSquared)) {
        best = { ...candidate, distanceSquared, priority }
      }
    }
  }

  return best ?? center
}
