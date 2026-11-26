import { distance, edges, pointInPolygon, points, polygon, union } from './assistant/planGeometry.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'
import { getStairLayout, stairGuardrailMinSetback, type StairRailPoint } from './stairDesign.ts'
import { getStairLandingPosition } from './stairLandings.ts'
import { wallOpeningEdgeInterval } from './stairOpeningFit.ts'
import type { PlacedModel, Point, Wall } from './types.ts'

const EPSILON = 0.00001
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const offset = (p: Point, direction: Point, amount: number): Point => ({ x: p.x + direction.x * amount, y: p.y + direction.y * amount })

export function usesAutomaticStairwellGuardrails(definition: ModelDefinition) {
  return !!definition.stairDesign && !definition.stairDesign.upperGuardrail && /^agent-[\da-f-]+(?:-stair)?-variety$/i.test(definition.id)
}

function boundaryCuts(from: Point, to: Point, rings: Point[][]) {
  const direction = subtract(to, from)
  return rings.flatMap(ring => edges(ring).flatMap(([a, b]) => {
    const edge = subtract(b, a), denominator = cross(direction, edge)
    if (Math.abs(denominator) < EPSILON) return []
    const relative = subtract(a, from)
    const t = cross(relative, edge) / denominator, u = cross(relative, direction) / denominator
    return t > EPSILON && t < 1 - EPSILON && u >= 0 && u <= 1 ? [t] : []
  }))
}

function wallBarriers(walls: Wall[], railHeight: number, margin: number) {
  return walls.flatMap(wall => {
    const length = distance(wall.start, wall.end)
    if (wall.height < railHeight || length < EPSILON) return []
    const direction = { x: (wall.end.x - wall.start.x) / length, y: (wall.end.y - wall.start.y) / length }
    const gaps = (wall.openings ?? []).filter(opening => opening.bottom < railHeight && opening.bottom + opening.height > .15)
      .map(opening => [Math.max(0, opening.center - opening.width / 2), Math.min(length, opening.center + opening.width / 2)])
      .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
    let end = 0
    return [...gaps, [length, length]].flatMap(([from, to]) => {
      const start = end
      end = Math.max(end, to)
      return from > start ? [{ ...wall, start: offset(wall.start, direction, start - margin),
        end: offset(wall.start, direction, from + margin), thickness: wall.thickness + margin * 2 }] : []
    })
  })
}

/** Follow the rendered cutout, using only floor-supported edges outside the stair exit and walls. */
export function getOpenStairwellGuardrails(model: PlacedModel, definition: ModelDefinition, openings: Point[][],
  footprints: Point[][], walls: Wall[]): StairRailPoint[][] {
  const design = definition.stairDesign
  if (!design || !openings.length || !footprints.length) return []
  const rings = union(openings.map(polygon)).flatMap(shape => shape.map(points))
  const margin = stairGuardrailMinSetback(design) + .012
  const barriers = wallBarriers(walls, design.railHeight, margin)
  const placed = model.flipped ? { ...model, rotation: model.rotation + Math.PI } : model
  const arrival = getStairLandingPosition(placed, definition, 'upper')
  const direction = subtract(getStairLandingPosition(placed, definition, 'upper', -1), arrival)
  const flight = getStairLayout(design).flights.at(-1)!
  const left = flight.left.at(-1)!, right = flight.right.at(-1)!
  const exitWidth = Math.hypot((left.x - right.x) * (model.widthScale ?? 1),
    (left.z - right.z) * (model.depthScale ?? 1)) * (model.scale || 1)
  // A returning stair may exit beside the foot of its first flight. Clear just its own flight.
  const exit = { start: offset(arrival, direction, -margin), end: offset(arrival, direction, .5 + margin),
    thickness: exitWidth + margin * 2, id: '', kind: 'internal' as const, height: design.railHeight }
  const blocked = [...barriers, exit]
  return rings.flatMap(ring => {
    // Polygon clipping winds the opening on the left of each boundary, including inner rings.
    const outline = edges(ring)
    const normals = outline.map(([a, b]) => {
      const length = distance(a, b) || 1
      return { x: (b.y - a.y) / length, y: (a.x - b.x) / length }
    })
    const shifted = ring.map((point, index) => {
      const a = normals.at(index - 1)!, b = normals[index]
      return offset(point, { x: a.x + b.x, y: a.y + b.y }, margin / Math.max(.35, 1 + dot(a, b)))
    })
    const paths: Point[][] = []
    for (const [index, [from, to]] of edges(shifted).entries()) {
      const vector = subtract(to, from)
      if (dot(vector, subtract(outline[index][1], outline[index][0])) <= EPSILON) continue
      const intervals = blocked.flatMap(wall => {
        const hit = wallOpeningEdgeInterval(from, to, wall)
        return hit ? [hit] : []
      })
      const spans = [0, 1, ...intervals.flat(), ...boundaryCuts(from, to, [...footprints, ...rings])].sort((a, b) => a - b)
      for (const [i, start] of spans.slice(0, -1).entries()) {
        const end = spans[i + 1], middle = (start + end) / 2
        if (end - start < EPSILON || intervals.some(([a, b]) => middle >= a && middle <= b)) continue
        const sample = offset(from, vector, middle)
        if (!footprints.some(floor => pointInPolygon(sample, floor)) ||
            openings.some(opening => pointInPolygon(sample, opening))) continue
        const first = offset(from, vector, start), last = offset(from, vector, end)
        const tail = paths.at(-1)
        if (tail && distance(tail.at(-1)!, first) < EPSILON) tail.push(last)
        else paths.push([first, last])
      }
    }
    if (paths.length > 1 && distance(paths.at(-1)!.at(-1)!, paths[0][0]) < EPSILON) {
      paths[0] = [...paths.pop()!, ...paths[0].slice(1)]
    }
    return paths.filter(path => path.slice(1).reduce((length, point, index) => length + distance(path[index], point), 0) > design.postWidth)
      .map(path => path.map(({ x, y }) => ({ x, y: 0, z: y })))
  })
}
