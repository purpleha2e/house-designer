import { restoreIndirectVisibility } from './indirectVisibility.ts'
import { traceIndirectLampRows, type IndirectLampTask } from './indirectLampPreparation.ts'

function trace(task: IndirectLampTask, reply: { postMessage: (message: unknown, options?: StructuredSerializeOptions) => void }) {
  let visibility: ReturnType<typeof restoreIndirectVisibility> | undefined
  try {
    visibility = restoreIndirectVisibility(task.visibility)
    const data = traceIndirectLampRows(task, visibility)
    reply.postMessage({ ok: true, data }, { transfer: [data.buffer] })
  } catch (error) {
    reply.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally { visibility?.dispose() }
}
self.onmessage = (event: MessageEvent<IndirectLampTask | { port: MessagePort }>) => {
  if ('port' in event.data) {
    const port = event.data.port
    port.onmessage = ({ data }: MessageEvent<IndirectLampTask>) => { trace(data, port); port.close() }
  } else trace(event.data, self)
}
