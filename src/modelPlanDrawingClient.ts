import type { ModelPlanDrawing } from './modelPlanDrawing'

let worker: Worker | undefined, id = 0
const pending = new Map<number, { resolve: (drawing: ModelPlanDrawing) => void; reject: (error: Error) => void }>()
export function traceModelPlanPreview(canvas: HTMLCanvasElement): Promise<ModelPlanDrawing> {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  if (!worker) {
    worker = new Worker(new URL('./modelPlanDrawing.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id); pending.delete(data.id)
      if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.drawing)
    }
    worker.onerror = () => {
      pending.forEach(request => request.reject(new Error('Could not trace the object plan.'))); pending.clear()
      worker?.terminate(); worker = undefined
    }
  }
  return new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    worker!.postMessage({ id, pixels, width: canvas.width, height: canvas.height }, [pixels.buffer])
  })
}
