import { restoreIndirectVisibility } from './indirectVisibility.ts'
import { traceIndirectLampRows, type IndirectLampTask } from './indirectLampPreparation.ts'

self.onmessage = (event: MessageEvent<IndirectLampTask>) => {
  let visibility: ReturnType<typeof restoreIndirectVisibility> | undefined
  try {
    visibility = restoreIndirectVisibility(event.data.visibility)
    const data = traceIndirectLampRows(event.data, visibility)
    self.postMessage({ ok: true, data }, { transfer: [data.buffer] })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally { visibility?.dispose() }
}
