import type { WallMeshFace } from './wallMesh.ts'
import type { WallSelectionInput } from './wallSelectionPreparation.ts'
import type { WallRenderJob } from './wallRenderPreparation.ts'
import type { WallRoofClipInputJob, WallRoofClipJob } from './wallRoofClipJob.ts'

export type WallWorkerJob = WallRenderJob | WallRoofClipJob | WallRoofClipInputJob | (WallRoofClipInputJob & {
  selection: WallSelectionInput; render?: Omit<WallRenderJob, 'kind' | 'faces'>
})
export const WALL_MESSAGE_FACE_LIMIT = 128
export type WallWorkerMessage = WallWorkerJob |
  { stream: 'start'; job: WallWorkerJob; sharedWallFaces: boolean } |
  { stream: 'faces'; field: 'faces' | 'wallFaces'; faces: WallMeshFace[] } |
  { stream: 'end' }

/** Structured cloning a whole roof-cut storey can block input for hundreds of
 * milliseconds. Keep each browser serialization/deserialization task bounded. */
export function* wallWorkerMessages(job: WallWorkerJob): Generator<WallWorkerMessage> {
  const wallFaces = 'input' in job ? job.input.wallFaces : undefined
  if (job.faces.length <= WALL_MESSAGE_FACE_LIMIT && (!wallFaces || wallFaces.length <= WALL_MESSAGE_FACE_LIMIT)) {
    yield job; return
  }
  const sharedWallFaces = wallFaces === job.faces
  yield { stream: 'start', job: { ...job, faces: [], ...('input' in job ? { input: { ...job.input, wallFaces: wallFaces ? [] : undefined } } : {}) }, sharedWallFaces }
  for (let i = 0; i < job.faces.length; i += WALL_MESSAGE_FACE_LIMIT)
    yield { stream: 'faces', field: 'faces', faces: job.faces.slice(i, i + WALL_MESSAGE_FACE_LIMIT) }
  if (wallFaces && !sharedWallFaces) for (let i = 0; i < wallFaces.length; i += WALL_MESSAGE_FACE_LIMIT)
    yield { stream: 'faces', field: 'wallFaces', faces: wallFaces.slice(i, i + WALL_MESSAGE_FACE_LIMIT) }
  yield { stream: 'end' }
}

export function createWallMessageReceiver() {
  let pending: WallWorkerJob | undefined
  return (message: WallWorkerMessage): WallWorkerJob | undefined => {
    if (!('stream' in message)) return message
    if (message.stream === 'start') {
      pending = message.job
      if (message.sharedWallFaces && 'input' in pending) pending.input.wallFaces = pending.faces
    } else if (message.stream === 'faces') {
      if (!pending) throw new Error('Wall data arrived without a job')
      const target = message.field === 'faces' ? pending.faces : 'input' in pending ? pending.input.wallFaces : undefined
      if (!target) throw new Error('Wall data has no destination')
      target.push(...message.faces)
    } else {
      const result = pending; pending = undefined
      if (!result) throw new Error('Wall job finished without data')
      return result
    }
  }
}
