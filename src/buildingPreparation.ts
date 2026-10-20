import { createRoofAssemblyJob, restoreRoofAssemblyJob, type RoofAssemblyJob } from './roofAssemblyJob.ts'
import { resolveBuildingRoofs, type BuildingRoof } from './roofBuildingGeometry.ts'
import { buildBuildingRoomVolumes, type BuildingRoomVolumes } from './buildingRoomVolumes.ts'
import { buildBuildingRoofGables, getGableWallClipData } from './roofGableGeometry.ts'
import type { FloorLevel } from './types.ts'
import { buildStoreyGeometry, type FloorAssembly } from './storeyGeometry.ts'
import type { RenderedFloorData } from './threeDLevelPreparation.ts'
import { getFloorSlabFootprints } from './ceilingSlabFootprint.ts'
import { buildFloorWallSurfaceFaces } from './wallEngine/floorWallSurfaceMesh.ts'
import type { WallSide } from './wallEngine/wallGraph.ts'
import { indirectProjectKey, indirectProjectAssetKey } from './indirectLightingPersistence.ts'

type EncodedRoof = Omit<BuildingRoof, 'resolved'> & { resolved: RoofAssemblyJob[number]['resolved'] }
export function encodeBuildingRoofs(roofs: BuildingRoof[]): EncodedRoof[] {
  return roofs.map(roof => ({ ...roof, resolved: createRoofAssemblyJob([{ resolved: roof.resolved }])[0].resolved }))
}
export function restoreBuildingRoofs(roofs: EncodedRoof[]): BuildingRoof[] {
  return roofs.map(roof => ({ ...roof, resolved: restoreRoofAssemblyJob([{ resolved: roof.resolved }])[0].resolved }))
}
export type BuildingPreparationRequest = {
  kind: 'rooms'; roofFloors: FloorLevel[]; roomFloors: FloorLevel[]
} | {
  kind: 'gables'; floors: FloorLevel[]; roofs: EncodedRoof[]; rooms: BuildingRoomVolumes
  assemblies: Pick<FloorAssembly, 'bottom' | 'top' | 'footprints'>[]
} | {
  kind: 'storeys'; floors: { data: RenderedFloorData; exteriorSides: Map<string, WallSide>; openingDepths: Map<string, number> }[]; assemblyFloorIds: string[]
  roofContacts: Parameters<typeof buildStoreyGeometry>[2]
  wallBodyPerimeters: boolean; roomSurfaces: boolean
} | {
  kind: 'lighting-keys'; project: Parameters<typeof indirectProjectKey>[0]
  models: Map<string, unknown>; materials: Map<string, unknown>
}
export function prepareBuildingRooms(roofFloors: FloorLevel[], roomFloors: FloorLevel[]) {
  const roofs = resolveBuildingRoofs(roofFloors)
  return { roofs: encodeBuildingRoofs(roofs), rooms: buildBuildingRoomVolumes(roomFloors, roofs) }
}
export function prepareBuildingGables(request: Extract<BuildingPreparationRequest, { kind: 'gables' }>) {
  const roofs = restoreBuildingRoofs(request.roofs)
  const gables = buildBuildingRoofGables(request.floors, roofs, request.rooms, request.assemblies)
  return { gables, clipData: new Map(request.floors.map(floor => [floor.id, getGableWallClipData(gables, roofs, floor.id, floor.elevation)])) }
}

export function prepareBuildingStoreys(request: Extract<BuildingPreparationRequest, { kind: 'storeys' }>) {
  return buildStoreyGeometry(request.floors.map(({ data, exteriorSides, openingDepths }) => ({
    floor: data.floor, footprints: getFloorSlabFootprints(data.floor),
    faces: buildFloorWallSurfaceFaces({
      renderedWalls: data.renderedWalls, rooms: data.rooms,
      useWallBodyPerimeterMesh: request.wallBodyPerimeters, roomSurfaceRendererEnabled: request.roomSurfaces,
      exteriorWallSidesByWallId: exteriorSides, verticalUvOffset: data.floor.elevation,
      wallOpeningDepthsByModelId: openingDepths,
    }),
  })), new Set(request.assemblyFloorIds), request.roofContacts)
}

export function prepareLightingCacheKeys(request: Extract<BuildingPreparationRequest, { kind: 'lighting-keys' }>) {
  return { projectKey: indirectProjectKey(request.project),
    assetKey: indirectProjectAssetKey(request.project, request.models, request.materials) }
}
