import type { Point, SelectableSurface, Wall, WallSurfaceFragmentReference } from '../types.ts'
import type { DetectedRoom } from '../wallTopology.ts'
import type { WallMeshFace } from './wallMesh.ts'
import { buildWallBufferGeometryPayload } from './wallBuffer.ts'
import { buildCoplanarWallSurfaceGroups } from './wallSurfaceGroups.ts'
import { appendExternalWallCapFragmentsToGroups, buildConnectedExternalWallSurfaceGroups, buildRoomWallSurfaceGroups, createWallSurfacePickTarget, isExteriorWallSurfaceFragment, isWallFragmentExposedAboveAdjacentRoof } from '../wallAdjoiningSurfaces.ts'

export type WallSelectionInput = { floorId: string; walls: Wall[]; rooms: DetectedRoom[]; exteriorWallSidesByWallId: Map<string,-1|1>; roofSupports: {roofId:string;supportPolygon:Point[]}[] }

/** Build exact picking groups beside clipping; never expand all fragments in React. */
export function prepareWallSelection(faces: WallMeshFace[], {floorId,walls,rooms,exteriorWallSidesByWallId,roofSupports}: WallSelectionInput) {
  const wallsById=new Map(walls.map(wall=>[wall.id,wall]))
  const coplanarSurfaceGroups=buildCoplanarWallSurfaceGroups(faces)
    const classifiedFragments = faces.flatMap((face) => {
      if (face.kind !== 'side' || typeof face.pickSource.side !== 'number') {
        return []
      }

      const wall = wallsById.get(face.pickSource.wallId)

      if (!wall) {
        return []
      }

      const normalLength = Math.hypot(face.normal[0], face.normal[2])

      if (normalLength <= 0.000001) {
        return []
      }

      const center = face.vertices.reduce(
        (point, vertex) => ({
          x: point.x + vertex.position[0] / face.vertices.length,
          y: point.y + vertex.position[2] / face.vertices.length,
        }),
        { x: 0, y: 0 },
      )
      const normal = {
        x: face.normal[0] / normalLength,
        y: face.normal[2] / normalLength,
      }
      // The plan room can extend behind this face, but above its roof the
      // surface is exterior. Do not split a facade at that room's end wall.
      const exposedAboveRoof = isWallFragmentExposedAboveAdjacentRoof(face, roofSupports)
      const adjacentRoom = exposedAboveRoof ? undefined :
        (face.roomSignature
          ? rooms.find((room) => room.signature === face.roomSignature)
          : undefined) ??
        getRenderableRoomContainingPoint(rooms, {
          x: center.x + normal.x * 0.08,
          y: center.y + normal.y * 0.08,
        })
      // A short corner return can sit beyond the room's inset outline.
      // Check behind either end as well as its centre before falling back to
      // a whole-wall side (which can be ambiguous on a shared wall run).
      const oppositeRoom = [0, -wall.thickness, wall.thickness].map(offset =>
        getRenderableRoomContainingPoint(rooms, {
          x: center.x - normal.x * (wall.thickness + 0.08) - normal.y * offset,
          y: center.y - normal.y * (wall.thickness + 0.08) + normal.x * offset,
        }),
      ).find(Boolean)
      const detectedExteriorSide = exteriorWallSidesByWallId.get(wall.id)

      return [
        {
          adjacentRoomSignature: adjacentRoom?.signature ?? null,
          fragment: {
            fragmentId: face.faceId,
            side: face.pickSource.side,
            wallId: face.pickSource.wallId,
          },
          isExterior: exposedAboveRoof || isExteriorWallSurfaceFragment({
                  detectedExteriorSide,
                  hasAdjacentRoom: Boolean(adjacentRoom),
                  hasOppositeRoom: Boolean(oppositeRoom),
                  side: face.pickSource.side,
                  wallKind: wall.kind,
                }),
        },
      ]
    })
    const groups = buildConnectedExternalWallSurfaceGroups({
      fragments: classifiedFragments
        .filter(({ isExterior }) => isExterior)
        .map(({ fragment }) => fragment),
      walls,
    })
    const roomGroups = buildRoomWallSurfaceGroups(
      classifiedFragments.flatMap(
        ({ adjacentRoomSignature, fragment }) =>
          adjacentRoomSignature
            ? [{ fragment, roomSignature: adjacentRoomSignature }]
            : [],
      ),
    )

    roomGroups.forEach((fragments, surfaceKey) => {
      groups.set(surfaceKey, fragments)
    })

    const adjoiningSurfaceGroups = {
      groups: appendExternalWallCapFragmentsToGroups({ classifiedFragments, faces, groups, walls }),
      roomFragmentIds: new Set(classifiedFragments.filter(f => f.adjacentRoomSignature).map(f => f.fragment.fragmentId)),
    }
      const hiddenRoofFaceIds = new Set(faces.filter(face => face.roofSurfaceRegion?.includes(':below') &&
        !adjoiningSurfaceGroups.roomFragmentIds.has(face.faceId)).map(face => face.faceId))
      const nextPayload = buildWallBufferGeometryPayload(faces, {
        floorId,
        groupBy: 'face',
      })
      const pickTargets = new Map<number, SelectableSurface>()
      const revealGroups = new Map<
        WallSurfaceFragmentReference[],
        WallSurfaceFragmentReference[] | undefined
      >()
      const withReveals = (fragments: WallSurfaceFragmentReference[] | undefined) => {
        if (!fragments) return undefined
        const cached = revealGroups.get(fragments)
        if (cached) return cached
        const extended = fragments.filter(fragment => !hiddenRoofFaceIds.has(fragment.fragmentId)).flatMap(fragment => [fragment,
          ...(coplanarSurfaceGroups.get(fragment.fragmentId) ?? []).filter(ref => /:opening(?:-boundary)?:/.test(ref.fragmentId))])
        const result = [...new Map(extended.map(ref => [`${ref.wallId}:${ref.side}:${ref.fragmentId}`, ref])).values()]
        revealGroups.set(fragments, result)
        return result
      }

      nextPayload.pickTargets.forEach((target, materialIndex) => {
          if (target.type !== 'wall-surface-fragment') {
            pickTargets.set(materialIndex, target)
            return
          }

          pickTargets.set(
            materialIndex,
            createWallSurfacePickTarget({
              adjoiningFragments: hiddenRoofFaceIds.has(target.fragmentId)
                ? coplanarSurfaceGroups.get(target.fragmentId)
                : withReveals(adjoiningSurfaceGroups.groups.get(
                `${target.wallId}:${target.side}:${target.fragmentId}`,
              )),
              coplanarFragments: coplanarSurfaceGroups.get(target.fragmentId),
              target,
            }),
          )
        })

      return {
        ...nextPayload,
        pickTargets,
      }

}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function isPointOnSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point,
  tolerance = 0.0001,
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLength = Math.hypot(segmentDx, segmentDy)

  if (segmentLength < tolerance) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y) <= tolerance
  }

  const cross =
    (point.x - segmentStart.x) * segmentDy -
    (point.y - segmentStart.y) * segmentDx

  if (Math.abs(cross) > tolerance * segmentLength) {
    return false
  }

  const dot =
    (point.x - segmentStart.x) * segmentDx +
    (point.y - segmentStart.y) * segmentDy

  return dot >= -tolerance && dot <= segmentLength * segmentLength + tolerance
}

function isPointInsidePolygon(point: Point, polygon: Point[]) {
  let inside = false

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInsideOrOnPolygon(point: Point, polygon: Point[]) {
  return (
    polygon.some((polygonPoint, index) =>
      isPointOnSegment(
        point,
        polygonPoint,
        polygon[(index + 1) % polygon.length],
      ),
    ) || isPointInsidePolygon(point, polygon)
  )
}

function getRoomContainingPoint(rooms: DetectedRoom[], point: Point) {
  return (
    rooms.find((room) => isPointInsideOrOnPolygon(point, room.polygon)) ?? null
  )
}

function getRenderableRoomContainingPoint(
  rooms: DetectedRoom[],
  point: Point,
  roomSurfacePolygonsBySignature?: Map<string, Point[]>,
) {
  const containingRooms = rooms
    .flatMap((room) => {
      const polygon = getRenderableRoomPolygon(
        room,
        roomSurfacePolygonsBySignature,
      )

      return polygon && isPointInsideOrOnPolygon(point, polygon)
        ? [{ polygon, room }]
        : []
    })
    .sort(
      (first, second) =>
        Math.abs(getSignedArea(first.polygon)) -
        Math.abs(getSignedArea(second.polygon)),
    )

  return containingRooms[0]?.room ?? getRoomContainingPoint(rooms, point)
}

function hasRenderablePlanPolygon(polygon: Point[]) {
  if (polygon.length < 3) {
    return false
  }

  return Math.abs(getSignedArea(polygon)) > 0.000001
}

function getRenderableRoomPolygon(
  room: DetectedRoom,
  roomSurfacePolygonsBySignature?: Map<string, Point[]>,
) {
  const composedPolygon = roomSurfacePolygonsBySignature?.get(room.signature)

  if (composedPolygon && hasRenderablePlanPolygon(composedPolygon)) {
    return composedPolygon
  }

  return hasRenderablePlanPolygon(room.polygon) ? room.polygon : null
}

