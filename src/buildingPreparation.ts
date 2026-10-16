import { createRoofAssemblyJob, restoreRoofAssemblyJob, type RoofAssemblyJob } from './roofAssemblyJob.ts'
import { resolveBuildingRoofs, type BuildingRoof } from './roofBuildingGeometry.ts'
import { buildBuildingRoomVolumes, type BuildingRoomVolumes } from './buildingRoomVolumes.ts'
import { buildBuildingRoofGables, getGableWallClipData } from './roofGableGeometry.ts'
import type { FloorLevel } from './types.ts'
import type { FloorAssembly } from './storeyGeometry.ts'

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
