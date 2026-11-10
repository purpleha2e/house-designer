/// <reference lib="webworker" />
import { bakeExteriorSkyOcclusion } from './exteriorSkyOcclusion'
import type { IndirectGeometrySnapshot } from './indirectVisibility'
import { bakeExteriorEaveField } from './exteriorEaveOcclusion'

self.onmessage = (event: MessageEvent<{ parts: IndirectGeometrySnapshot; roofParts: IndirectGeometrySnapshot }>) => {
  try {
    const field = bakeExteriorSkyOcclusion(event.data.parts, 48, percent => self.postMessage({ kind: 'progress', percent }))
    const eaves = bakeExteriorEaveField(event.data.roofParts)
    self.postMessage({ kind: 'ready', field, eaves }, [field.positive.buffer, field.negative.buffer, ...(eaves ? [eaves.data.buffer] : [])])
  } catch (error) { self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
