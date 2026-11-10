import { runWallRoofClipJob, runWallRoofClipInputJob } from './wallRoofClipJob.ts'
import { prepareWallSelection } from './wallSelectionPreparation.ts'
import { prepareWallRendering } from './wallRenderPreparation.ts'
import { transferWallBufferPayload } from './wallBuffer.ts'
import { createWallMessageReceiver, WALL_MESSAGE_FACE_LIMIT, type WallWorkerMessage } from './wallWorkerMessages.ts'

const receive = createWallMessageReceiver()
function sendFaces(faces: import('./wallMesh.ts').WallMeshFace[], stream = 'faces') {
  for (let i = 0; i < faces.length; i += WALL_MESSAGE_FACE_LIMIT)
    self.postMessage({ stream, faces: faces.slice(i, i + WALL_MESSAGE_FACE_LIMIT) })
}
self.onmessage = (event: MessageEvent<WallWorkerMessage>) => {
  try {
    const job = receive(event.data)
    if (!job) return
    if ('kind' in job) {
      const result = prepareWallRendering(job)
      const packed = transferWallBufferPayload(result.payload)
      sendFaces(result.renderFaces)
      self.postMessage({ ok: true, streamedFaces: true, result: { renderFaces: [], payload: packed.payload } }, { transfer: packed.buffers })
      return
    }
    const faces = 'input' in job ? runWallRoofClipInputJob(job) : runWallRoofClipJob(job)
    const packed = 'selection' in job ? transferWallBufferPayload(prepareWallSelection(faces, job.selection)) : undefined
    const rendering = 'render' in job && job.render ? prepareWallRendering({ kind: 'render', faces, ...job.render }) : undefined
    const renderPacked = rendering ? transferWallBufferPayload(rendering.payload) : undefined
    sendFaces(faces)
    if (rendering) sendFaces(rendering.renderFaces, 'renderFaces')
    self.postMessage({ ok: true, streamedFaces: true, pickPayload: packed?.payload, renderPayload: renderPacked?.payload },
      { transfer: [...(packed?.buffers ?? []), ...(renderPacked?.buffers ?? [])] })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
