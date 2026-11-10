import type { RootState } from '@react-three/fiber'
import { snapshotIndirectGeometry, type IndirectGeometrySnapshot } from '../../src/indirectVisibility'
import { indirectGeometryRanges } from '../../src/indirectVisibility'
import { InstancedMesh, Mesh } from 'three'
export const snapshotGeometryChangeInput = (s: RootState) => snapshotIndirectGeometry(s.scene)
export function geometrySnapshotAudit(s: RootState) {
  let visibleBatchTriangles = 0, visibleBatchMeshes = 0
  s.scene.traverseVisible(object => {
    if (!(object instanceof Mesh) || object.userData.houseDesignerRole !== 'model-batch') return
    visibleBatchMeshes++
    visibleBatchTriangles += indirectGeometryRanges(object).reduce((sum, range) => sum + Math.floor(range.count / 3), 0) * (object instanceof InstancedMesh ? object.count : 1)
  })
  return { visibleBatchTriangles, visibleBatchMeshes, note: 'The current production visibility snapshot explicitly excludes model-batch meshes; these counts audit that omission separately.' }
}
export function compareGeometryChangeInputs(before: IndirectGeometrySnapshot, after: IndirectGeometrySnapshot) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometryChangeProfile.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.ok) resolve(data); else reject(Error(data.error)) }
    worker.onerror = event => { worker.terminate(); reject(Error(event.message)) }
    worker.postMessage({ before, after })
  })
}
