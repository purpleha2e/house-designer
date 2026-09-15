import type {
  SelectableSurface,
  Wall,
  WallFaceReference,
  WallSurfaceFragmentReference,
  Point,
} from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'
import { buildWallTopology } from './wallTopology.ts'
import { footprintPlanes } from './wallEngine/wallRoofClip.ts'

/** Extended junction panels can cross a wall without enclosing its room side. */
export function isWallFragmentExposedAboveAdjacentRoof(
  face: WallMeshFace,
  roofs: Array<{ roofId: string; supportPolygon: Point[] }>,
) {
  if (face.roomSignature || face.roofSurfaceRegion !== 'roof-exposed') return false
  const length = Math.hypot(face.normal[0], face.normal[2])
  if (length < 1e-6) return false
  const x = face.vertices.reduce((sum, v) => sum + v.position[0], 0) / face.vertices.length + face.normal[0] / length * 0.08
  const z = face.vertices.reduce((sum, v) => sum + v.position[2], 0) / face.vertices.length + face.normal[2] / length * 0.08
  const regions = face.faceId.split(':roof-region:')[1]?.split('/') ?? []
  return roofs.some(roof => regions.some(region => region.startsWith(`${roof.roofId}:`) && region.endsWith(':above')) &&
    roof.supportPolygon.length >= 3 && footprintPlanes(roof.supportPolygon).every(plane => plane([x, 0, z]) >= -1e-6))
}

function uniqueFragments(fragments: WallSurfaceFragmentReference[]) {
  const fragmentsByKey = new Map<string, WallSurfaceFragmentReference>()

  fragments.forEach((fragment) => {
    fragmentsByKey.set(
      `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
      fragment,
    )
  })

  return [...fragmentsByKey.values()].sort(
    (first, second) =>
      first.wallId.localeCompare(second.wallId) ||
      first.side - second.side ||
      first.fragmentId.localeCompare(second.fragmentId),
  )
}

export function isExteriorWallSurfaceFragment({
  hasAdjacentRoom,
  hasOppositeRoom,
  detectedExteriorSide,
  side,
  wallKind,
}: {
  hasAdjacentRoom: boolean
  hasOppositeRoom: boolean
  detectedExteriorSide?: -1 | 1
  side: -1 | 1
  wallKind: Wall['kind']
}) {
  return (
    wallKind === 'external' &&
    !hasAdjacentRoom &&
    (hasOppositeRoom ||
      (!hasOppositeRoom && side === detectedExteriorSide))
  )
}

/**
 * Shift-selection must start from the exact rendered fragment under the
 * pointer. A normal pick may use a canonical coplanar fragment, but that
 * group can legitimately touch faces belonging to the room next door.
 */
export function getAdjoiningWallSurfaceSelection(
  surface: Extract<SelectableSurface, { type: 'wall-surface-fragment' }>,
) {
  const pickedFragment = surface.pickedFragment ?? {
    fragmentId: surface.fragmentId,
    side: surface.side,
    wallId: surface.wallId,
  }

  return {
    ...surface,
    ...pickedFragment,
    fragments:
      surface.adjoiningFragments && surface.adjoiningFragments.length > 0
        ? surface.adjoiningFragments
        : [pickedFragment],
  }
}

export function createWallSurfacePickTarget({
  adjoiningFragments,
  coplanarFragments,
  target,
}: {
  adjoiningFragments?: WallSurfaceFragmentReference[]
  coplanarFragments?: WallSurfaceFragmentReference[]
  target: Extract<SelectableSurface, { type: 'wall-surface-fragment' }>
}) {
  const adjoiningKeys = adjoiningFragments
    ? new Set(
        adjoiningFragments.map(
          (fragment) =>
            `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
        ),
      )
    : null
  const safeCoplanarFragments = adjoiningKeys
    ? coplanarFragments?.filter((fragment) =>
        adjoiningKeys.has(
          `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
        ),
      )
    : undefined

  return {
    ...target,
    adjoiningFragments,
    fragments:
      safeCoplanarFragments && safeCoplanarFragments.length > 0
        ? safeCoplanarFragments
        : [
            {
              fragmentId: target.fragmentId,
              side: target.side,
              wallId: target.wallId,
            },
          ],
    pickedFragment: target,
  }
}

export function buildRoomWallSurfaceGroups(
  entries: Array<{
    fragment: WallSurfaceFragmentReference
    roomSignature: string
  }>,
) {
  const fragmentsByRoomSignature = new Map<
    string,
    WallSurfaceFragmentReference[]
  >()

  entries.forEach(({ fragment, roomSignature }) => {
    fragmentsByRoomSignature.set(roomSignature, [
      ...(fragmentsByRoomSignature.get(roomSignature) ?? []),
      fragment,
    ])
  })

  const groupsBySurface = new Map<string, WallSurfaceFragmentReference[]>()

  fragmentsByRoomSignature.forEach((roomFragments) => {
    const fragments = uniqueFragments(roomFragments)

    fragments.forEach((fragment) => {
      groupsBySurface.set(
        `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
        fragments,
      )
    })
  })

  return groupsBySurface
}

export function buildRoomWallFaceGroups(
  entries: Array<{ roomSignature: string; wallFace: WallFaceReference }>,
) {
  const fragmentsByRoomSignature = new Map<string, WallFaceReference[]>()

  entries.forEach(({ roomSignature, wallFace }) => {
    fragmentsByRoomSignature.set(roomSignature, [
      ...(fragmentsByRoomSignature.get(roomSignature) ?? []),
      wallFace,
    ])
  })

  const groups = new Map<string, WallFaceReference[]>()

  fragmentsByRoomSignature.forEach((roomWallFaces) => {
    const wallFaces = [
      ...new Map(
        roomWallFaces.map((wallFace) => [
          `${wallFace.wallId}:${wallFace.side}`,
          wallFace,
        ]),
      ).values(),
    ].sort(
      (first, second) =>
        first.wallId.localeCompare(second.wallId) || first.side - second.side,
    )

    wallFaces.forEach((wallFace) => {
      groups.set(`${wallFace.wallId}:${wallFace.side}`, wallFaces)
    })
  })

  return groups
}

export function appendExternalWallCapFragmentsToGroups({
  classifiedFragments,
  faces,
  groups,
  walls,
}: {
  classifiedFragments: Array<{
    fragment: WallSurfaceFragmentReference
    isExterior: boolean
  }>
  faces: Array<Pick<WallMeshFace, 'faceId' | 'kind' | 'pickSource'>>
  groups: Map<string, WallSurfaceFragmentReference[]>
  walls: Wall[]
}) {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const externalWallIds = new Set(
    walls.filter((wall) => wall.kind === 'external').map((wall) => wall.id),
  )
  const neighboursByWallId = new Map(
    [...externalWallIds].map((wallId) => [wallId, new Set<string>()]),
  )

  buildWallTopology(walls).nodes.forEach((node) => {
    const connectedExternalWallIds = node.connections
      .map((connection) => connection.wall.id)
      .filter((wallId) => externalWallIds.has(wallId))

    connectedExternalWallIds.forEach((wallId) => {
      connectedExternalWallIds.forEach((otherWallId) => {
        if (otherWallId !== wallId) {
          neighboursByWallId.get(wallId)?.add(otherWallId)
        }
      })
    })
  })

  const getConnectedExternalWallIds = (wallId: string) => {
    const connectedWallIds = new Set([wallId])
    const pendingWallIds = [wallId]

    while (pendingWallIds.length > 0) {
      const currentWallId = pendingWallIds.pop()!

      neighboursByWallId.get(currentWallId)?.forEach((neighbourId) => {
        if (!connectedWallIds.has(neighbourId)) {
          connectedWallIds.add(neighbourId)
          pendingWallIds.push(neighbourId)
        }
      })
    }

    return connectedWallIds
  }
  const exteriorFragmentIds = new Set(
    classifiedFragments
      .filter(({ isExterior }) => isExterior)
      .map(({ fragment }) => fragment.fragmentId),
  )

  faces
    .filter(
      (face) =>
        (face.kind === 'cap' || face.pickSource.role === 'cap') &&
        exteriorFragmentIds.has(face.faceId) &&
        typeof face.pickSource.side === 'number' &&
        wallsById.get(face.pickSource.wallId)?.kind === 'external',
    )
    .forEach((face) => {
      const side = face.pickSource.side

      if (typeof side !== 'number') {
        return
      }

      const sameWallAnchor = classifiedFragments.find(
        ({ fragment, isExterior }) =>
          isExterior &&
          fragment.fragmentId !== face.faceId &&
          fragment.wallId === face.pickSource.wallId &&
          fragment.side === side,
      )
      const connectedExternalWallIds = getConnectedExternalWallIds(
        face.pickSource.wallId,
      )
      const anchor =
        sameWallAnchor ??
        classifiedFragments.find(
          ({ fragment, isExterior }) =>
            isExterior &&
            fragment.fragmentId !== face.faceId &&
            connectedExternalWallIds.has(fragment.wallId),
        )
      const anchorKey = anchor
        ? `${anchor.fragment.wallId}:${anchor.fragment.side}:${anchor.fragment.fragmentId}`
        : null
      const currentGroup =
        (anchorKey ? groups.get(anchorKey) : undefined) ??
        uniqueFragments(
          classifiedFragments
            .filter(
              ({ fragment }) =>
                fragment.wallId === face.pickSource.wallId &&
                fragment.side === side,
            )
            .map(({ fragment }) => fragment),
        )

      if (currentGroup.length === 0) {
        return
      }

      const capFragment = {
        fragmentId: face.faceId,
        side,
        wallId: face.pickSource.wallId,
      }
      const extendedGroup = uniqueFragments([...currentGroup, capFragment])

      extendedGroup.forEach((fragment) => {
        groups.set(
          `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
          extendedGroup,
        )
      })
    })

  return groups
}

/**
 * Groups known exterior-facing fragments by connected wall perimeter. The
 * caller classifies individual rendered fragments first because one source
 * wall can be exterior along only part of its length.
 */
export function buildConnectedExternalWallSurfaceGroups({
  fragments,
  walls,
}: {
  fragments: WallSurfaceFragmentReference[]
  walls: Wall[]
}) {
  const externalWalls = walls.filter((wall) => wall.kind === 'external')
  const externalWallIds = new Set(externalWalls.map((wall) => wall.id))
  const neighboursByWallId = new Map(
    externalWalls.map((wall) => [wall.id, new Set<string>()]),
  )
  const topology = buildWallTopology(walls)

  topology.nodes.forEach((node) => {
    const connectedIds = node.connections
      .map((connection) => connection.wall.id)
      .filter((wallId) => externalWallIds.has(wallId))

    connectedIds.forEach((wallId) => {
      connectedIds.forEach((otherWallId) => {
        if (otherWallId !== wallId) {
          neighboursByWallId.get(wallId)?.add(otherWallId)
        }
      })
    })
  })

  const groupsBySurface = new Map<string, WallSurfaceFragmentReference[]>()
  const visited = new Set<string>()

  externalWalls.forEach((startWall) => {
    if (visited.has(startWall.id)) {
      return
    }

    const componentWallIds: string[] = []
    const pendingWallIds = [startWall.id]
    visited.add(startWall.id)

    while (pendingWallIds.length > 0) {
      const wallId = pendingWallIds.pop()!
      componentWallIds.push(wallId)

      neighboursByWallId.get(wallId)?.forEach((neighbourId) => {
        if (!visited.has(neighbourId)) {
          visited.add(neighbourId)
          pendingWallIds.push(neighbourId)
        }
      })
    }

    const componentWallIdSet = new Set(componentWallIds)
    const componentFragments = uniqueFragments(
      fragments.filter((fragment) => componentWallIdSet.has(fragment.wallId)),
    )

    componentFragments.forEach((fragment) => {
      groupsBySurface.set(
        `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
        componentFragments,
      )
    })
  })

  return groupsBySurface
}
