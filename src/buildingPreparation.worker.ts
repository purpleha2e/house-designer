import { prepareBuildingGables, prepareBuildingRooms, type BuildingPreparationRequest } from './buildingPreparation.ts'
self.onmessage = ({ data }: MessageEvent<BuildingPreparationRequest>) => {
  try {
    self.postMessage({ ok: true, result: data.kind === 'rooms' ? prepareBuildingRooms(data.roofFloors, data.roomFloors) : prepareBuildingGables(data) })
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
}
