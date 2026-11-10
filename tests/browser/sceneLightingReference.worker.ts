import { createSceneLightingReference, type ReferenceReceiver, type ReferenceSceneData } from '../sceneLightingReference'

self.onmessage = ({ data }: MessageEvent<{ scene: ReferenceSceneData; points: ReferenceReceiver[]; samples?: number }>) => {
  const started = performance.now(), reference = createSceneLightingReference(data.scene), preparedMs = performance.now() - started
  try {
    const results = data.points.map((point, index) => {
      self.postMessage({progress:{stage:'independent diffuse paths',index,name:point.name,total:data.points.length}})
      return reference.evaluate(point, data.samples ?? 16384, 6, 1234 + index * 1009)
    })
    self.postMessage({ ok: true, results, preparedMs, totalMs: performance.now() - started })
  } catch (error) { self.postMessage({ ok: false, error: String(error) }) }
  finally { reference.dispose() }
}
