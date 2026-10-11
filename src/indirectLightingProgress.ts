/** Publish a few startup previews without rebuilding the volume after every probe. */
export function shouldPublishIndirectPreview(completed: number, probes: number) {
  return completed < probes && [8, 32, 128, 512].includes(completed)
}

/** Uncaptured probes are missing data; captured black probes remain valid. */
export function indirectPreviewPositions(positions: Float32Array, probes: readonly { index: number }[], captured: ReadonlySet<number>) {
  const result = positions.slice()
  for (const probe of probes) if (!captured.has(probe.index)) result[probe.index * 4 + 3] = 0
  return result
}

export type IndirectLightingStatus = {
  state?: string; enabled?: boolean; blocked?: boolean; paused?: boolean
  completed?: number; total?: number; volumePending?: boolean; displayed?: boolean
  preparing?: boolean; warming?: boolean; reading?: boolean; pendingUpdate?: boolean; xr?: boolean
  floorPreparing?: boolean
  probes?: number; capturedProbes?: number; rooms?: number; reflections?: number
  pass?: number; reflection?: boolean; face?: number
  saving?: boolean; saved?: boolean; source?: string; exportable?: boolean
  partial?: boolean; zones?: number; reusedProbes?: number; firstProbes?: number; secondProbes?: number
}

export function formatIndirectLightingProgress(status?: IndirectLightingStatus) {
  if (!status) return 'GI preparing'
  if (status.enabled === false) return 'GI off'
  if (status.state === 'fallback') return 'GI unavailable'
  if (status.state === 'loading') return 'GI loading saved lighting'
  if (status.saving) return 'GI saving lighting'
  if (status.floorPreparing) return 'GI refining floor lighting'
  if (status.state === 'ready' && !status.volumePending) return 'GI ready'
  if (status.blocked || status.state === 'preparing' || !status.total) return 'GI preparing'
  const progress = Math.min(99, Math.floor(100 * (status.completed ?? 0) / status.total))
  return `GI ${status.displayed ? 'refining' : 'building'} ${progress}%${status.paused ? ' (paused)' : ''}`
}

/** Longer status for the engine activity area; transient editor work has priority. */
export function formatIndirectLightingEngineStatus(status?: IndirectLightingStatus) {
  if (!status) return 'GI preparing'
  if (status.enabled === false) return 'GI off'
  if (status.state === 'fallback') return 'GI unavailable'
  if (status.state === 'loading') return 'GI loading saved lighting'
  if (status.saving) return 'GI compressing lighting for saving'
  if (status.floorPreparing) return 'GI refining floor lighting from saved probes'
  if (status.blocked) return 'GI waiting for scene preparation or editing'
  if (status.xr) return 'GI paused during VR'
  if (status.state === 'ready' && !status.volumePending && !status.pendingUpdate) {
    return `GI ready · ${status.probes ?? 0} probes · ${status.reflections ?? 0} reflections${status.source === 'saved' ? ' · loaded from model' : status.saved ? ' · ready to save with model' : status.exportable === false ? ' · show all floors to save GI' : ''}`
  }
  const progress = status.total ? ` · ${Math.min(99, Math.floor(100 * (status.completed ?? 0) / status.total))}%` : ''
  const suffix = status.displayed ? ' · cached light displayed' : ''
  if (status.preparing || status.state === 'preparing') return `GI placing probes and checking visibility${suffix}`
  if (status.warming) return `GI preparing capture shaders${suffix}`
  if (status.volumePending) return `GI building irradiance volume${progress}${suffix}`
  if (status.paused) return `GI paused for navigation / input${progress}${suffix}`
  if (status.pendingUpdate || !status.total) return `GI waiting to update${suffix}`
  if (status.reflection) return `GI capturing reflections · ${status.reflections ?? 0}/${status.rooms ?? 0}${progress}`
  const first = status.firstProbes ?? status.probes ?? 0, second = status.secondProbes ?? status.probes ?? 0
  const captured = status.pass === 2 ? Math.max(0, (status.completed ?? 0) - first) : status.partial ? Math.min(first, status.completed ?? 0) : status.capturedProbes ?? 0
  const zones = status.partial ? ` · ${status.zones ?? 0} zones · ${status.reusedProbes ?? 0} probes reused` : ''
  return `GI bounce ${status.pass ?? 1} · ${captured}/${status.pass === 2 ? second : first} probes · ${status.reading ? 'reading light' : `face ${Math.min(6, (status.face ?? 0) + 1)}/6`}${zones}${progress}${suffix}`
}
