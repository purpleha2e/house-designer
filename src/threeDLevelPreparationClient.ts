import type { FloorLevel } from './types.ts'
import {
  prepareRenderedFloorData,
  type RenderedFloorData,
} from './threeDLevelPreparation.ts'
import type {
  LevelPreparationWorkerRequest,
  LevelPreparationWorkerResponse,
} from './threeDLevelPreparation.worker.ts'

let nextLevelPreparationJobId = 0

function createLevelPreparationWorker() {
  return new Worker(
    new URL('./threeDLevelPreparation.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

function getLevelPreparationWorkerCount(floorCount: number) {
  const hardwareLimit =
    typeof navigator === 'undefined'
      ? 2
      : Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4))

  return Math.max(1, Math.min(floorCount, hardwareLimit))
}

export function prepareRenderedFloorsSync(floors: FloorLevel[]) {
  return floors.map(prepareRenderedFloorData)
}

export function prepareRenderedFloorsInWorkers(
  floors: FloorLevel[],
  {
    signal,
  }: {
    signal?: AbortSignal
  } = {},
) {
  if (floors.length === 0 || typeof Worker === 'undefined') {
    return Promise.resolve(prepareRenderedFloorsSync(floors))
  }

  const jobId = ++nextLevelPreparationJobId
  const workerCount = getLevelPreparationWorkerCount(floors.length)
  const workers = Array.from({ length: workerCount }, createLevelPreparationWorker)
  const results: RenderedFloorData[] = new Array(floors.length)
  let nextFloorIndex = 0
  let completedCount = 0

  return new Promise<RenderedFloorData[]>((resolve, reject) => {
    let abort: () => void
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      workers.forEach((worker) => worker.terminate())
    }
    const fail = (error: unknown) => {
      cleanup()
      reject(error)
    }
    const finish = () => {
      cleanup()
      resolve(results)
    }
    const assignNextFloor = (worker: Worker) => {
      if (signal?.aborted) {
        fail(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }

      const index = nextFloorIndex
      nextFloorIndex += 1

      if (index >= floors.length) {
        return
      }

      const request: LevelPreparationWorkerRequest = {
        floor: floors[index],
        index,
        jobId,
      }

      worker.postMessage(request)
    }
    abort = () => {
      fail(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })

    workers.forEach((worker) => {
      worker.onmessage = (
        event: MessageEvent<LevelPreparationWorkerResponse>,
      ) => {
        const response = event.data

        if (response.jobId !== jobId) {
          return
        }

        if (!response.ok) {
          fail(new Error(response.error))
          return
        }

        results[response.index] = response.data
        completedCount += 1

        if (completedCount >= floors.length) {
          finish()
          return
        }

        assignNextFloor(worker)
      }
      worker.onerror = (event) => {
        fail(event.error ?? new Error(event.message))
      }
      worker.onmessageerror = () => {
        fail(new Error('Level preparation worker message could not be cloned.'))
      }
      assignNextFloor(worker)
    })
  })
}
