import type { IndirectLightingStatus } from './indirectLightingProgress.ts'

/** An unchanged view needs only occasional refreshes while the GPU bakes GI.
 * Camera movement and editing always retain the normal display frame rate. */
export function shouldRenderSceneFrame(now: number, lastDraw: number, viewChanged: boolean,
  editing: boolean, lighting?: IndirectLightingStatus, geometryPending = false) {
  // The previous geometry is already on screen. Let the worker finish instead
  // of competing with repeated draws, but keep navigation and dragging live.
  if (geometryPending && !viewChanged && !editing) return false
  const baking = lighting?.enabled !== false && lighting?.state !== 'ready' && lighting?.state !== 'fallback' &&
    (lighting?.preparing || lighting?.warming || lighting?.reading || lighting?.volumePending || lighting?.state === 'refining')
  return viewChanged || editing || !baking || !!lighting?.paused || now - lastDraw >= 100
}
