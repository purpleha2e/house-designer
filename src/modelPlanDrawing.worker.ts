import { createModelPlanDrawing } from './modelPlanDrawing'

self.onmessage = ({ data }: MessageEvent<{ id: number; pixels: Uint8ClampedArray; width: number; height: number }>) => {
  try {
    const drawing = createModelPlanDrawing(data.pixels, data.width, data.height)
    self.postMessage({ id: data.id, drawing }, { transfer: [...drawing.outlines, ...drawing.lines].map(path => path.buffer) })
  } catch (error) { self.postMessage({ id: data.id, error: String(error) }) }
}
