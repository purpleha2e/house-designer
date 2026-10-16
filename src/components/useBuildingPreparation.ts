import { startTransition, useEffect, useState } from 'react'
import { publishViewportUpdate } from '../viewportScheduling'
import { encodeBuildingRoofs, restoreBuildingRoofs, type BuildingPreparationRequest, type prepareBuildingRooms, type prepareBuildingGables } from '../buildingPreparation'
import type { BuildingRoof } from '../roofBuildingGeometry'
import type { BuildingRoomVolumes } from '../buildingRoomVolumes'
import type { FloorLevel } from '../types'
import type { FloorAssembly } from '../storeyGeometry'

function request<T>(data: BuildingPreparationRequest, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker | undefined
    const finish = (error?: unknown, value?: T) => {
      signal.removeEventListener('abort', abort); worker?.terminate()
      if (error) reject(error); else resolve(value!)
    }
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      if (signal.aborted) { abort(); return }
      worker = new Worker(new URL('../buildingPreparation.worker.ts', import.meta.url), { type: 'module' })
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => data.ok ? finish(undefined, data.result) : finish(new Error(data.error))
      worker.onerror = event => finish(new Error(event.message || 'Building preparation failed'))
      worker.onmessageerror = () => finish(new Error('Building preparation response could not be read'))
      worker.postMessage(data)
    } catch (error) { finish(error) }
  })
}
export function useBuildingRooms(roofKey: string, roomKey: string) {
  const key = roofKey + roomKey
  const [prepared, setPrepared] = useState<{ key: string; roofs: BuildingRoof[]; rooms: BuildingRoomVolumes }>({
    key: '', roofs: [], rooms: { cuts: [], exteriorTrimCuts: [], ceilingFaces: [], roomPolygonsByFloor: new Map() },
  })
  useEffect(() => {
    const controller = new AbortController()
    void request<ReturnType<typeof prepareBuildingRooms>>({ kind: 'rooms', roofFloors: JSON.parse(roofKey), roomFloors: JSON.parse(roomKey) }, controller.signal)
      .then(result => publishViewportUpdate(() => startTransition(() => setPrepared({ key, roofs: restoreBuildingRoofs(result.roofs), rooms: result.rooms })), () => controller.signal.aborted))
      .catch(error => { if (!controller.signal.aborted) console.error('Building preparation failed:', error) })
    return () => controller.abort()
  }, [key, roofKey, roomKey])
  return { ...prepared, pending: prepared.key !== key }
}
export function useBuildingGables(floors: FloorLevel[], roofs: BuildingRoof[], rooms: BuildingRoomVolumes,
  assemblies: Pick<FloorAssembly, 'bottom' | 'top' | 'footprints'>[], roomKey: string) {
  const key = roomKey + JSON.stringify(assemblies)
  const [prepared, setPrepared] = useState<{ key: string; value: ReturnType<typeof prepareBuildingGables> }>({ key: '', value: { gables: [], clipData: new Map() } })
  useEffect(() => {
    const controller = new AbortController()
    void request<ReturnType<typeof prepareBuildingGables>>({ kind: 'gables', floors, roofs: encodeBuildingRoofs(roofs), rooms, assemblies }, controller.signal)
      .then(value => publishViewportUpdate(() => startTransition(() => setPrepared({ key, value })), () => controller.signal.aborted))
      .catch(error => { if (!controller.signal.aborted) console.error('Gable preparation failed:', error) })
    return () => controller.abort()
  }, [key, floors, roofs, rooms, assemblies])
  return { value: prepared.value.gables, clipData: prepared.value.clipData, pending: prepared.key !== key }
}
