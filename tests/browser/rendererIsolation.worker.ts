import { createIsolationRenderer } from './rendererIsolationRuntime'
import { isolationNow, type IsolationCommand } from './rendererIsolationProtocol'
const scope = self as unknown as DedicatedWorkerGlobalScope
let renderer: Awaited<ReturnType<typeof createIsolationRenderer>> | undefined
scope.onmessage = async ({ data }: MessageEvent<IsolationCommand>) => {
  try {
    if (data.type === 'init') {
      if (renderer || !data.canvas) throw Error('Renderer requires exactly one transferred canvas')
      renderer = await createIsolationRenderer(data.canvas, data.generation, event => scope.postMessage(event))
    } else renderer?.command(data)
  } catch (error) { scope.postMessage({ type: 'error', generation: data.generation, revision: data.revision, at: isolationNow(), error: String(error) }) }
}
