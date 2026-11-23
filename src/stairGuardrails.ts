import {
  stairGuardrailFullLength,
  stairGuardrailMinSetback,
  type getStairLayout,
  type StairDesign,
  type StairRailPoint,
} from './stairDesign.ts'

/** The side return starts at the top newel. The end rail spans the opening above the foot of the stairs. */
export function getStairGuardrailPaths(design: StairDesign, layout: ReturnType<typeof getStairLayout>,
  upperFloorHeight = design.totalRise): { side: StairRailPoint[]; oppositeEnd: StairRailPoint[] } {
  const guardrail = design.upperGuardrail
  if (!guardrail) return { side: [], oppositeEnd: [] }
  const point = (x: number, z: number) => ({ x, z, y: upperFloorHeight })
  const { minX, maxX } = layout.bounds
  const farEnd = layout.lower.z - guardrail.setback
  const oppositeEnd = guardrail.oppositeEnd ? [
    point(guardrail.side === 'left' ? minX - guardrail.setback : minX, farEnd),
    point(guardrail.side === 'right' ? maxX + guardrail.setback : maxX, farEnd),
  ] : []
  if (!guardrail.side) return { side: [], oppositeEnd }
  const sign = guardrail.side === 'left' ? -1 : 1
  const x = sign * (design.width / 2 + guardrail.setback), z = layout.upper.z
  const fullLength = stairGuardrailFullLength(design, guardrail)
  const length = guardrail.length ?? fullLength
  // A shortened side rail close to the end uses the same newel as the end rail.
  const meetsEnd = guardrail.oppositeEnd && fullLength - length < design.postWidth
  return { side: [
    point(sign * (design.width / 2 - stairGuardrailMinSetback(design) - .005), z),
    point(x, z),
    point(x, meetsEnd ? farEnd : z - length),
  ], oppositeEnd }
}

/** Cut up to the opening-facing newel faces so the posts are supported by the floor. */
export function getStairGuardrailOpening(design: StairDesign, layout: ReturnType<typeof getStairLayout>) {
  if (!design.upperGuardrail) return null
  const { side, oppositeEnd } = getStairGuardrailPaths(design, layout)
  const { minX, maxX, minZ, maxZ } = layout.bounds
  const halfPost = design.postWidth / 2
  const endZ = oppositeEnd.length ? Math.min(minZ, oppositeEnd[0].z + halfPost) : minZ
  const sign = design.upperGuardrail.side === 'left' ? -1 : 1
  const sideEnd = side.at(-1)
  const outerX = sideEnd ? Math.max(maxX, sign * sideEnd.x - halfPost) : maxX
  const partial = sideEnd && sideEnd.z > endZ + 1e-7 && outerX > maxX + 1e-7
  const point = (x: number, z: number) => ({ x: sign * x, z })
  const fixedEdges = new Set<number>()
  if (oppositeEnd.length) fixedEdges.add(0)
  if (partial) {
    const sideStart = sideEnd.z + halfPost
    for (const edge of [2, 3, 4]) fixedEdges.add(edge)
    return { polygon: [
      point(minX, endZ), point(maxX, endZ), point(maxX, sideStart),
      point(outerX, sideStart), point(outerX, maxZ), point(minX, maxZ),
    ], fixedEdges }
  }
  if (sideEnd) {
    fixedEdges.add(1)
    fixedEdges.add(2)
  }
  return { polygon: [point(minX, endZ), point(outerX, endZ), point(outerX, maxZ), point(minX, maxZ)], fixedEdges }
}
