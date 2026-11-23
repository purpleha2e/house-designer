import type { Scene } from 'three'
import type { ViewportLightingModel } from './viewportLightingModel'

const emptyWork = () => ({
  cacheKeyRequests: 0,
  probeSessions: 0,
  probeLayouts: 0,
  probeCaptureBatches: 0,
  lumenWorkers: 0,
})
type Work = keyof ReturnType<typeof emptyWork>
type LightingAudit = { mode: ViewportLightingModel; designEntries: number; design: ReturnType<typeof emptyWork>; preview: ReturnType<typeof emptyWork> }

export function publishViewportLightingMode(scene: Scene, mode: ViewportLightingModel) {
  const previous = scene.userData.viewportLightingWork as LightingAudit | undefined
  const audit = previous ?? { mode, designEntries: 0, design: emptyWork(), preview: emptyWork() }
  if (mode === 'design' && (!previous || audit.mode !== mode)) audit.designEntries++
  audit.mode = mode
  scene.userData.viewportLightingWork = audit
}

export function recordViewportLightingWork(scene: Scene, work: Work) {
  const audit = scene.userData.viewportLightingWork as LightingAudit | undefined
  if (audit) (audit.mode === 'design' ? audit.design : audit.preview)[work]++
}
