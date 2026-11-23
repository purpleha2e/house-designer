export const lumenGridSpacing = .12
export const lumenGridDimensions = [88, 48, 88]

/** Keep a compact building's apertures and receivers inside the same grid.
 * Leave room for the outer wall faces and for grid-origin quantization. */
export function fitLumenRegion(minimum: number[], maximum: number[]) {
  const clearance = .72
  if (maximum.some((value, axis) => value - minimum[axis] + clearance > lumenGridDimensions[axis] * lumenGridSpacing)) return undefined
  return minimum.map((value, axis) => (value + maximum[axis]) * .5)
}
