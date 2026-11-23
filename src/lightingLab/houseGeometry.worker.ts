import { prepareHouseGeometry, type HousePart } from './houseGeometry'
import { prepareCoarseHouseParts } from './houseCoarseModels'
self.onmessage = async (event: MessageEvent<HousePart[]>) => {
  try {
    const started = performance.now()
    const progress = (message: string) => self.postMessage({ message })
    const parts = await prepareCoarseHouseParts(event.data, progress)
    const result = prepareHouseGeometry(parts, progress)
    result.preparationMs = performance.now() - started
    const buffers = [result.position.buffer, result.normal.buffer, result.uv.buffer, result.chart.buffer, result.depth.buffer,result.vertexLightChart.buffer,result.vertexLighting.buffer,
      ...result.tree.roots, result.tree.index!.buffer]
    if (result.display) buffers.push(result.display.position.buffer, result.display.normal.buffer, result.display.uv.buffer,
      result.display.chart.buffer, result.display.vertexLightChart.buffer, result.display.vertexLighting.buffer)
    self.postMessage({ result }, { transfer: buffers })
  } catch (error) { self.postMessage({ error: String(error) }) }
}
