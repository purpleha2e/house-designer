import type { AssistantJob } from './assistant.worker.ts'
import { asRecord } from './intent.ts'
import type { AgentEvent, AgentProgress, AgentRequest, AgentReply, AgentReport } from './architecturalTools.ts'
import { abortable } from './abortable.ts'

const endpoint = '/api/workspace/assistant/agent'
const workspaceIdleMilliseconds = 25_000

export async function availableAgentModes(signal: AbortSignal) {
  try {
    const response = await fetch(endpoint, { signal })
    const modes = response.ok ? asRecord(await response.json()) : null
    return { demo: modes?.demo === true, live: modes?.live === true }
  } catch { return { demo: false, live: false } }
}

export class AgentRequestError extends Error {
  constructor(message: string, report?: AgentReport, retryable = false) {
    super(message)
    this.report = report
    this.retryable = retryable
  }
  readonly report?: AgentReport
  readonly retryable: boolean
}

export async function requestDesignAgent(input: AgentRequest, signal: AbortSignal, onProgress: (event: AgentProgress) => void): Promise<AgentReply> {
  const source = { ...input.source, roofIdsByFloor: input.source.floors.map(floor => ({ floorId: floor.id, ids: floor.roofs?.map(roof => roof.id) ?? [] })),
    floors: input.source.floors.map(floor => ({ ...floor, roofs: undefined, groundImage: undefined })) }
  const previous = input.previous ? { ...input.previous, landingRoute: [] } : null
  const idle = new AbortController()
  const streamSignal = AbortSignal.any([signal, idle.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let connected = false
  const keepAlive = () => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(), workspaceIdleMilliseconds)
  }
  try {
    keepAlive()
    const response = await abortable(() => fetch(endpoint, { method: 'POST', signal: streamSignal, headers: {
      'Content-Type': 'application/json', 'X-House-Designer-Client': 'editor',
    }, body: JSON.stringify({ ...input, source, previous }) }), streamSignal)
    connected = true
    keepAlive()
    if (!response.ok || !response.body) {
      const data = asRecord(await abortable(() => response.json().catch(() => null), streamSignal))
      throw new AgentRequestError(typeof data?.error === 'string' ? data.error : 'The design agent is unavailable. Check the editor server and try again.',
        undefined, response.status >= 500)
    }
    const stream = reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', bytes = 0
    for (;;) {
      const { value, done } = await abortable(() => stream.read(), streamSignal)
      if (value?.byteLength) keepAlive()
      bytes += value?.byteLength ?? 0
      if (bytes > 2_200_000) throw new Error('The agent response exceeded its size limit.')
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as AgentEvent
        if (event.type === 'phase') onProgress(event)
        else if (event.type === 'error') throw new AgentRequestError(event.text, event.report, event.retryable)
        else if (event.type === 'result') return event.result
      }
      if (done) throw new AgentRequestError('The workspace server closed the reply before a design result arrived.', undefined, true)
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (idle.signal.aborted) throw new AgentRequestError(connected
      ? 'The editor stopped receiving updates from the workspace server.'
      : 'The workspace server did not answer the editor.', undefined, true)
    if (error instanceof TypeError) throw new AgentRequestError('The connection between the editor and the workspace server was interrupted.', undefined, true)
    throw error
  } finally {
    clearTimeout(timer)
    void reader?.cancel().catch(() => undefined)
  }
}

export function openAssistantWorker(signal: AbortSignal) {
  const worker = new Worker(new URL('./assistant.worker.ts', import.meta.url), { type: 'module' })
  const stop = () => worker.terminate()
  signal.addEventListener('abort', stop, { once: true })
  return {
    close() { signal.removeEventListener('abort', stop); stop() },
    run<T>(job: AssistantJob): Promise<T> {
      return new Promise((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener('abort', abort)
          worker.onmessage = null
          worker.onerror = null
        }
        const abort = () => { finish(); reject(signal.reason) }
        if (signal.aborted) { abort(); return }
        signal.addEventListener('abort', abort, { once: true })
        worker.onmessage = ({ data }: MessageEvent<{ value: T } | { error: string }>) => {
          finish()
          if ('error' in data) reject(new Error(data.error))
          else resolve(data.value)
        }
        worker.onerror = () => { finish(); reject(new Error('The layout planner could not start. Reload the editor and try again.')) }
        worker.postMessage(job)
      })
    },
  }
}
