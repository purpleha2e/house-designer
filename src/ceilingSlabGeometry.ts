import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Shape,
} from 'three'
import type { Point } from './types.ts'

export type CeilingSlabFacadeEdge = {
  materialIndex: number
  nextPoint: Point
  normalSign: -1 | 1
  point: Point
  topOverlap?: number
  uvBottom: number
  uvEnd: number
  uvStart: number
}

export function offsetEdgeTowardPoint(
  point: Point,
  nextPoint: Point,
  target: Point,
  distance: number,
) {
  const dx = nextPoint.x - point.x
  const dy = nextPoint.y - point.y
  const length = Math.hypot(dx, dy)

  if (length <= 0.000001 || distance === 0) {
    return { nextPoint, point }
  }

  const leftNormal = { x: -dy / length, y: dx / length }
  const midpoint = {
    x: (point.x + nextPoint.x) / 2,
    y: (point.y + nextPoint.y) / 2,
  }
  const direction =
    (target.x - midpoint.x) * leftNormal.x +
      (target.y - midpoint.y) * leftNormal.y >=
    0
      ? 1
      : -1
  const offset = {
    x: leftNormal.x * direction * distance,
    y: leftNormal.y * direction * distance,
  }

  return {
    nextPoint: {
      x: nextPoint.x + offset.x,
      y: nextPoint.y + offset.y,
    },
    point: {
      x: point.x + offset.x,
      y: point.y + offset.y,
    },
  }
}

/**
 * Builds slab caps and exterior facades in one geometry. Hole reveals are
 * intentionally owned by the opening-reveal renderer.
 */
export function createCeilingSlabGeometry(
  shape: Shape,
  depth: number,
  facadeEdges: readonly CeilingSlabFacadeEdge[],
  capInset = 0,
) {
  const source = new ExtrudeGeometry(shape, {
    bevelEnabled: false,
    depth,
  })
  const sourcePositions = source.getAttribute('position')
  const sourceUvs = source.getAttribute('uv')
  const capGroup = source.groups.find((group) => group.materialIndex === 0)
  const positions: number[] = []
  const uvs: number[] = []

  if (capGroup) {
    const capEnd = capGroup.start + capGroup.count

    for (let index = capGroup.start; index < capEnd; index += 1) {
      positions.push(
        sourcePositions.getX(index),
        sourcePositions.getY(index),
        sourcePositions.getZ(index) <= depth / 2
          ? Math.min(capInset, depth / 2)
          : Math.max(depth - capInset, depth / 2),
      )
      uvs.push(sourceUvs.getX(index), sourceUvs.getY(index))
    }
  }

  const geometry = new BufferGeometry()
  if (positions.length > 0) {
    geometry.addGroup(0, positions.length / 3, 0)
  }

  for (const edge of facadeEdges) {
    const start = positions.length / 3
    const facadeDepth = depth + (edge.topOverlap ?? 0)
    const vertices = [
      {
        position: [edge.point.x, -edge.point.y, 0],
        uv: [edge.uvStart, edge.uvBottom],
      },
      {
        position: [edge.nextPoint.x, -edge.nextPoint.y, 0],
        uv: [edge.uvEnd, edge.uvBottom],
      },
      {
        position: [edge.nextPoint.x, -edge.nextPoint.y, facadeDepth],
        uv: [edge.uvEnd, edge.uvBottom + facadeDepth],
      },
      {
        position: [edge.point.x, -edge.point.y, facadeDepth],
        uv: [edge.uvStart, edge.uvBottom + facadeDepth],
      },
    ]
    const triangleIndices =
      edge.normalSign === 1 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]

    for (const index of triangleIndices) {
      positions.push(...vertices[index].position)
      uvs.push(...vertices[index].uv)
    }
    geometry.addGroup(start, 6, edge.materialIndex)
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  source.dispose()
  return geometry
}
