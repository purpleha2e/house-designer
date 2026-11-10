import { Box3, Vector3 } from 'three'
import type { IndirectVisibility } from './indirectVisibility.ts'
import type {IndirectContactSeed} from './indirectContactProbes.ts'

export type IndirectProbeObstacle = { min: number[]; max: number[]; geometry?: boolean; contact?:boolean;seeds?:IndirectContactSeed[] }
const axes = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0),
  new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]

/** Stair bounds include usable air above treads and between flights. Use the
 * worker's existing triangle tree to distinguish it from solid wood. Ordinary
 * furniture keeps its conservative bounds; no extra tree or probes are needed. */
export function createIndirectProbeObstacles(obstacles: IndirectProbeObstacle[], visibility: Pick<IndirectVisibility, 'hit'>) {
  const boxes = obstacles.map(box => new Box3(new Vector3().fromArray(box.min), new Vector3().fromArray(box.max)))
  return { boxes, contains(point: Vector3) {
    return boxes.some((box, index) => {
      if (!box.containsPoint(point)) return false
      if (!obstacles[index].geometry) return true
      return axes.some(direction => {
        const axis = direction.x ? 'x' : direction.y ? 'y' : 'z'
        const sign = direction[axis]
        const exit = sign > 0 ? box.max[axis] - point[axis] : point[axis] - box.min[axis]
        const hit = visibility.hit(point, direction, exit + .001, .0001)
        // A nearby front face needs clearance; an outward-facing first hit
        // means the probe is inside a closed tread, post or stringer.
        return !!hit && (hit.distance < .08 || (hit.face?.normal.dot(direction) ?? 0) > .001)
      })
    })
  } }
}
