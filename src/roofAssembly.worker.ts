import { runRoofAssemblyJob, type RoofAssemblyJob } from './roofAssemblyJob.ts'
self.onmessage = ({ data }: MessageEvent<RoofAssemblyJob>) => {
  try {
    const result = runRoofAssemblyJob(data)
    const buffers = result.flatMap(([,parts]) => parts.flatMap(([,geometry]) => geometry
      ? [...geometry.attributes.map(([,array]) => array.buffer), ...(geometry.index ? [geometry.index.buffer] : [])] : []))
    self.postMessage({ ok: true, result }, { transfer: [...new Set(buffers)] })
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
}
