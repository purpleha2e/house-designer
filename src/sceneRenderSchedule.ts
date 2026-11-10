import type { IndirectLightingStatus } from './indirectLightingProgress.ts'

/** An unchanged view needs only occasional refreshes while the GPU bakes GI.
 * Camera movement and editing always retain the normal display frame rate. */
export function shouldRenderSceneFrame(now: number, lastDraw: number, viewChanged: boolean,
  editing: boolean, lighting?: IndirectLightingStatus, geometryPending = false, staticScene = false) {
  // Published tours contain no animation. Let the GPU rest between movements
  // once the final prepared scene is displayed; editors keep their live loop.
  const lightingSettled = lighting?.state === 'ready' || lighting?.state === 'fallback' || lighting?.enabled === false || lighting?.diffuseEnabled === false
  if (staticScene && lightingSettled && !viewChanged && !editing) return false
  // The previous geometry is already on screen. Let the worker finish instead
  // of competing with repeated draws, but keep navigation and dragging live.
  if (geometryPending && !viewChanged && !editing) return false
  const baking = lighting?.enabled !== false && lighting?.diffuseEnabled !== false && lighting?.state !== 'ready' && lighting?.state !== 'fallback' &&
    (lighting?.preparing || lighting?.warming || lighting?.reading || lighting?.volumePending || lighting?.state === 'refining')
  // Geometry, camera, light inputs and published GI explicitly mark changes.
  // Refresh an otherwise unchanged display only occasionally, leaving the GPU
  // and main thread available for the background calculation.
  return viewChanged || editing || !baking || !!lighting?.paused || now - lastDraw >= 1000
}
