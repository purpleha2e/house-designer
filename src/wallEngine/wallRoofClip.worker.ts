import { runWallRoofClipJob, type WallRoofClipJob } from './wallRoofClipJob.ts'

self.onmessage = (event: MessageEvent<WallRoofClipJob>) => {
  try {
    self.postMessage({ ok: true, faces: runWallRoofClipJob(event.data) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
