import { runWallRoofClipJob, runWallRoofClipInputJob, type WallRoofClipInputJob, type WallRoofClipJob } from './wallRoofClipJob.ts'
import { prepareWallSelection, type WallSelectionInput } from './wallSelectionPreparation.ts'
import { prepareWallRendering, type WallRenderJob } from './wallRenderPreparation.ts'

self.onmessage = (event: MessageEvent<WallRenderJob | WallRoofClipJob | WallRoofClipInputJob | (WallRoofClipInputJob & { selection: WallSelectionInput })>) => {
  try {
    if('kind' in event.data){self.postMessage({ok:true,result:prepareWallRendering(event.data)});return}
    const faces = 'input' in event.data ? runWallRoofClipInputJob(event.data) : runWallRoofClipJob(event.data)
    self.postMessage({ ok: true, faces,
      pickPayload: 'selection' in event.data ? prepareWallSelection(faces, event.data.selection) : undefined })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
