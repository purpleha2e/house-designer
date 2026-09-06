import type { FloorLevel } from './types.ts'
import {
  prepareRenderedFloorData,
  type RenderedFloorData,
} from './threeDLevelPreparation.ts'

export type LevelPreparationWorkerRequest = {
  floor: FloorLevel
  index: number
  jobId: number
}

export type LevelPreparationWorkerResponse =
  | {
      data: RenderedFloorData
      index: number
      jobId: number
      ok: true
    }
  | {
      error: string
      index: number
      jobId: number
      ok: false
    }

self.onmessage = (
  event: MessageEvent<LevelPreparationWorkerRequest>,
) => {
  const { floor, index, jobId } = event.data

  try {
    const data = prepareRenderedFloorData(floor)
    const response: LevelPreparationWorkerResponse = {
      data,
      index,
      jobId,
      ok: true,
    }

    self.postMessage(response)
  } catch (error) {
    const response: LevelPreparationWorkerResponse = {
      error: error instanceof Error ? error.message : String(error),
      index,
      jobId,
      ok: false,
    }

    self.postMessage(response)
  }
}

