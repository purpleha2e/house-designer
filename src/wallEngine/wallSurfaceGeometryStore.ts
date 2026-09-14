import type { WallMeshFace } from './wallMesh.ts'

const EMPTY: WallMeshFace[] = []

/** Per-view completed wall geometry, shared with facade finishes on slabs. */
export function createWallSurfaceGeometryStore() {
  const floors = new Map<string, WallMeshFace[]>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  return {
    get: (floorId: string) => floors.get(floorId) ?? EMPTY,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (floorId: string, faces: WallMeshFace[]) => {
      floors.set(floorId, faces)
      notify()
      return () => {
        if (floors.get(floorId) !== faces) return
        floors.delete(floorId)
        notify()
      }
    },
  }
}
