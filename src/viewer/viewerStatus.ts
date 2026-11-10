import type { IndirectLightingStatus } from '../indirectLightingProgress'

/** Plain-language activity for the tour, driven by the actual scene and lighting state. */
export function formatViewerStatus(preparation: string | null, lighting?: IndirectLightingStatus) {
  if (preparation) return preparation
  if (lighting?.enabled === false) return 'Scene ready.'
  if (lighting?.state === 'fallback') return `Scene ready. ${lighting.cacheReason ?? 'Indirect lighting unavailable.'}`
  if (lighting?.state === 'loading') return 'Loading saved lighting...'
  if (lighting?.state === 'preview') return 'Scene ready. Preview lighting.'
  if (lighting?.floorPreparing) return 'Preparing floor lighting...'
  if (lighting?.state === 'ready' && !lighting.volumePending && !lighting.pendingUpdate) return 'Scene ready.'
  if (lighting?.xr) return 'Lighting paused during VR.'
  if (lighting?.paused) return 'Lighting paused while moving...'
  if (!lighting || lighting.blocked || lighting.state === 'preparing') return 'Preparing lighting...'
  const progress = lighting.total ? ` ${Math.min(99, Math.floor(100 * (lighting.completed ?? 0) / lighting.total))}%` : ''
  return `Calculating lighting...${progress}`
}
