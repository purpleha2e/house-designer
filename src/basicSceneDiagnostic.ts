/** Reload-only diagnostic: keep the real geometry pipeline, omit rendering features. */
export const basicSceneDiagnostic = typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('basic-scene')
export const pbrMaterialDiagnostic = basicSceneDiagnostic &&
  new URLSearchParams(location.search).has('pbr-materials')
export const opaqueMaterialDiagnostic = basicSceneDiagnostic &&
  (new URLSearchParams(location.search).has('opaque-materials') || pbrMaterialDiagnostic)

export type BasicSceneReport = {
  startedAt: number
  readMs?: number
  parseMs?: number
  normalizeMs?: number
  catalogMs?: number
  mode?: 'basic' | 'opaque-materials' | 'pbr-materials'
  mapUsage?: Record<string, number>
  lights?: number
  materials?: number
  transparentMaterials?: number
  mountedAt?: number
  geometryReadyMs?: number
  settledMs?: number
  snapshotMs?: number
  drawMs?: number
  firstFrameMs?: number
  gpuCompleteMs?: number
  meshes?: number
  triangles?: number
  programs?: number
  textures?: number
  pending?: string[]
  error?: string
}
export const basicSceneReport: BasicSceneReport = { startedAt: 0 }
export function updateBasicSceneReport(values: Partial<BasicSceneReport>) {
  Object.assign(basicSceneReport, values)
  if (typeof window !== 'undefined') {
    Object.assign(window, { basicSceneReport })
    window.dispatchEvent(new Event('basic-scene-report'))
  }
}
