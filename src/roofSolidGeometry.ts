import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'
import { ROOF_TILE_THICKNESS_METERS } from './roofProfile.ts'
import type { Point } from './types.ts'
import { clipRoofFace, subtractRoofVolume } from './roofJunctions.ts'
import { footprintPlanes } from './wallEngine/wallRoofClip.ts'

export type RoofVertex = [number, number, number]

type RoofGeometryBuffers = {
  normals: number[]
  positions: number[]
  uvs: number[]
}

export type RoofGeometries = {
  eaves?: BufferGeometry | null
  shell: BufferGeometry
  soffit: BufferGeometry
  underside: BufferGeometry
  top: BufferGeometry
}

export type RoofFaceUvProjector = (vertices: RoofVertex[]) => Array<[number, number]>

/** Split room-side ceilings from exterior overhangs without changing their plane. */
export function splitRoofUndersideFaces(
  faces: RoofVertex[][],
  supportPolygon: Point[],
  visibleFaces: RoofVertex[][] = faces,
) {
  const planes = footprintPlanes(supportPolygon)
  return {
    undersideFaces: faces.map(face => planes.reduce(clipRoofFace, face)).filter(face => face.length),
    soffitFaces: visibleFaces.flatMap(face => subtractRoofVolume(face, planes)),
  }
}

/** Split a roof surface at the actual room outlines, including concave rooms. */
export function partitionRoofFacesByRooms(faces: RoofVertex[][], roomPolygons: Point[][]) {
  const roomTriangles = roomPolygons.flatMap((polygon) => {
    const outline = polygon.map(({ x, y }) => new Vector2(x, y))
    return ShapeUtils.triangulateShape(outline, []).map((indices) =>
      footprintPlanes(indices.map((index) => polygon[index])))
  })
  const inside: RoofVertex[][] = []
  const outside: RoofVertex[][] = []
  for (const face of faces) {
    let remaining = [face]
    for (const planes of roomTriangles) {
      inside.push(...remaining.map(piece => planes.reduce(clipRoofFace, piece))
        .filter(piece => piece.length))
      remaining = remaining.flatMap(piece => subtractRoofVolume(piece, planes))
      if (!remaining.length) break
    }
    outside.push(...remaining)
  }
  return { inside, outside }
}

function getRoofFaceProjectedUvs(vertices: RoofVertex[]) {
  if (vertices.length < 3) {
    return vertices.map(() => [0, 0] as [number, number])
  }

  const first = new Vector3(...vertices[0])
  const second = new Vector3(...vertices[1])
  const third = new Vector3(...vertices[2])
  const normal = second
    .clone()
    .sub(first)
    .cross(third.clone().sub(first))
    .normalize()
  const longestPlanEdge = vertices.reduce<{
    direction: Vector3
    lengthSq: number
  } | null>((current, vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length]
    const direction = new Vector3(
      nextVertex[0] - vertex[0],
      0,
      nextVertex[2] - vertex[2],
    )
    const lengthSq = direction.lengthSq()

    return !current || lengthSq > current.lengthSq
      ? { direction, lengthSq }
      : current
  }, null)
  const uAxis =
    longestPlanEdge && longestPlanEdge.lengthSq > 0.000001
      ? longestPlanEdge.direction.normalize()
      : new Vector3(1, 0, 0)
  const vAxis = normal.clone().cross(uAxis).normalize()

  return vertices.map((vertex) => {
    const position = new Vector3(...vertex)

    return [position.dot(uAxis), position.dot(vAxis)] as [number, number]
  })
}

export function getFlippedRoofFaceProjectedUvs(vertices: RoofVertex[]) {
  return getRoofFaceProjectedUvs(vertices).map(
    ([u, v]) => [-u, -v] as [number, number],
  )
}

export function createSolidRoofGeometryFromFaces(
  faces: RoofVertex[][],
  topUvProjector: RoofFaceUvProjector = getRoofFaceProjectedUvs,
  thickness = ROOF_TILE_THICKNESS_METERS,
  shellFaces: RoofVertex[][] = faces,
  undersideFaces: RoofVertex[][] = shellFaces,
  soffitFaces: RoofVertex[][] = [],
): RoofGeometries {
  const top: RoofGeometryBuffers = { positions: [], normals: [], uvs: [] }
  const underside: RoofGeometryBuffers = { positions: [], normals: [], uvs: [] }
  const soffit: RoofGeometryBuffers = { positions: [], normals: [], uvs: [] }
  const shell: RoofGeometryBuffers = { positions: [], normals: [], uvs: [] }
  const addTriangle = (
    buffers: RoofGeometryBuffers,
    first: RoofVertex,
    second: RoofVertex,
    third: RoofVertex,
    uvFirst: [number, number],
    uvSecond: [number, number],
    uvThird: [number, number],
    preferredDirection?: Vector3,
  ) => {
    const normal = new Vector3(
      second[0] - first[0],
      second[1] - first[1],
      second[2] - first[2],
    )
      .cross(
        new Vector3(
          third[0] - first[0],
          third[1] - first[1],
          third[2] - first[2],
        ),
      )
      .normalize()
    const shouldFlip = preferredDirection
      ? normal.dot(preferredDirection) < 0
      : false
    const ordered = shouldFlip ? [first, third, second] : [first, second, third]
    const orderedUvs = shouldFlip
      ? [uvFirst, uvThird, uvSecond]
      : [uvFirst, uvSecond, uvThird]

    if (shouldFlip) {
      normal.negate()
    }

    ordered.forEach((position) => {
      buffers.positions.push(...position)
      buffers.normals.push(normal.x, normal.y, normal.z)
    })
    orderedUvs.forEach((uv) => buffers.uvs.push(...uv))
  }
  const addFace = (
    buffers: RoofGeometryBuffers,
    face: RoofVertex[],
    yOffset: number,
    preferredDirection: Vector3,
    reverse = false,
    uvProjector: RoofFaceUvProjector = getRoofFaceProjectedUvs,
  ) => {
    const vertices = face.map(
      ([x, y, z]) => [x, y + yOffset, z] as RoofVertex,
    )
    const orderedVertices = reverse ? [...vertices].reverse() : vertices
    const orderedUvs = uvProjector(orderedVertices)

    for (let index = 1; index < orderedVertices.length - 1; index += 1) {
      addTriangle(
        buffers,
        orderedVertices[0],
        orderedVertices[index],
        orderedVertices[index + 1],
        orderedUvs[0],
        orderedUvs[index],
        orderedUvs[index + 1],
        preferredDirection,
      )
    }
  }
  const edgeKey = (first: RoofVertex, second: RoofVertex) => {
    const firstKey = first.map((value) => value.toFixed(5)).join(',')
    const secondKey = second.map((value) => value.toFixed(5)).join(',')

    return firstKey < secondKey
      ? `${firstKey}|${secondKey}`
      : `${secondKey}|${firstKey}`
  }
  const boundaryEdges = (sourceFaces: RoofVertex[][]) => {
    const edges = new Map<
    string,
    { count: number; first: RoofVertex; second: RoofVertex }
    >()

    sourceFaces.forEach((face) => {
      face.forEach((first, index) => {
        const second = face[(index + 1) % face.length]
        const key = edgeKey(first, second)
        const current = edges.get(key)

        edges.set(key, {
          count: (current?.count ?? 0) + 1,
          first,
          second,
        })
      })
    })
    return Array.from(edges.values()).filter(edge => edge.count === 1)
  }
  const structuralBoundary = boundaryEdges(shellFaces)
  const pointOnEdge = (point: RoofVertex, edge: { first: RoofVertex; second: RoofVertex }) => {
    const direction = edge.second.map((value, axis) => value - edge.first[axis])
    const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0)
    if (lengthSquared < 1e-12) return false
    const t = point.reduce((sum, value, axis) =>
      sum + (value - edge.first[axis]) * direction[axis], 0) / lengthSquared
    return t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(...point.map((value, axis) =>
      value - edge.first[axis] - t * direction[axis])) < 1e-5
  }
  // Keep only visible portions of authored perimeter edges. Boolean roof cuts
  // create new boundaries which must not become vertical tiled strips, while a
  // fully hidden panel must not leave its original fascia floating on a wall.
  const visibleShellEdges = boundaryEdges(faces).filter(edge => structuralBoundary.some(source =>
    pointOnEdge(edge.first, source) && pointOnEdge(edge.second, source)))

  faces.forEach((face) => {
    addFace(top, face, 0, new Vector3(0, 1, 0), false, topUvProjector)
  })
  undersideFaces.forEach((face) => {
    addFace(
      underside,
      face,
      -thickness,
      new Vector3(0, -1, 0),
      true,
      getRoofFaceProjectedUvs,
    )
  })
  soffitFaces.forEach((face) => {
    addFace(
      soffit,
      face,
      -thickness,
      new Vector3(0, -1, 0),
      true,
      getRoofFaceProjectedUvs,
    )
  })

  visibleShellEdges.forEach(({ first, second }) => {
      const bottomSecond: RoofVertex = [
        second[0],
        second[1] - thickness,
        second[2],
      ]
      const bottomFirst: RoofVertex = [
        first[0],
        first[1] - thickness,
        first[2],
      ]
      const horizontalNormal = new Vector3(
        second[2] - first[2],
        0,
        first[0] - second[0],
      ).normalize()

      addTriangle(
        shell,
        first,
        second,
        bottomSecond,
        [0, first[1]],
        [
          Math.hypot(second[0] - first[0], second[2] - first[2]),
          second[1],
        ],
        [
          Math.hypot(second[0] - first[0], second[2] - first[2]),
          bottomSecond[1],
        ],
        horizontalNormal,
      )
      addTriangle(
        shell,
        first,
        bottomSecond,
        bottomFirst,
        [0, first[1]],
        [
          Math.hypot(second[0] - first[0], second[2] - first[2]),
          bottomSecond[1],
        ],
        [0, bottomFirst[1]],
        horizontalNormal,
      )
    })

  const createGeometry = (buffers: RoofGeometryBuffers) => {
    const geometry = new BufferGeometry()

    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(buffers.positions, 3),
    )
    geometry.setAttribute('normal', new Float32BufferAttribute(buffers.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(buffers.uvs, 2))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    return geometry
  }

  return {
    shell: createGeometry(shell),
    soffit: createGeometry(soffit),
    underside: createGeometry(underside),
    top: createGeometry(top),
  }
}

