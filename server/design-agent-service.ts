import type { ServerResponse } from 'node:http'
import { Worker } from 'node:worker_threads'
import type { AgentEvent, AgentRequest } from '../src/assistant/architecturalTools.ts'
import { defaultAgentLimits, type AgentLimits } from './design-agent-loop.ts'

export type AgentSettings = { credentials?: { apiKey: string; model: string }; limits?: Partial<AgentLimits> }
const heartbeatMilliseconds = 8_000

export function streamDesignAgent(response: ServerResponse, request: AgentRequest, settings: AgentSettings) {
  const limits = { ...defaultAgentLimits, ...settings.limits }
  return new Promise<void>(resolve => {
    const worker = new Worker(new URL('./design-agent.worker.ts', import.meta.url), {
      workerData: { request, limits, credentials: request.mode === 'live' ? settings.credentials : undefined },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
    response.flushHeaders()
    let finished = false
    function finish(event?: AgentEvent) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      response.removeListener('close', disconnect)
      if (!response.destroyed) response.end(event ? `${JSON.stringify(event)}\n` : undefined)
      void worker.terminate()
      resolve()
    }
    const disconnect = () => finish()
    const watchdog = { type: 'error', text: 'The workspace server reached its time limit before sending a result.', retryable: true } as const
    const timer = setTimeout(() => finish(watchdog), limits.milliseconds + 500)
    const heartbeat = setInterval(() => {
      if (!response.writableNeedDrain) response.write('{"type":"heartbeat"}\n')
    }, heartbeatMilliseconds)
    response.once('close', disconnect)
    if (response.destroyed) { finish(); return }
    worker.on('message', (message: unknown) => {
      // Node's file watcher also sends module-load notifications on this channel.
      if (finished || !message || typeof message !== 'object' || !('type' in message)) return
      const event = message as AgentEvent
      if (event.type === 'phase') response.write(`${JSON.stringify(event)}\n`)
      else if (event.type === 'result' || event.type === 'error') finish(event)
    })
    worker.once('error', error => {
      console.warn('[House Designer agent] Worker error', error.name, error.message)
      finish({ type: 'error', text: 'The workspace worker stopped before sending a design result.', retryable: true })
    })
    worker.once('exit', () => finish({ type: 'error', text: 'The agent stopped before returning a proposal.', retryable: true }))
  })
}

export function agentSettingsFromEnvironment(env: NodeJS.ProcessEnv): AgentSettings {
  const configured = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback)
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback
  }
  return {
    credentials: env.OPENAI_API_KEY && env.HOUSE_DESIGNER_OPENAI_MODEL ?
      { apiKey: env.OPENAI_API_KEY, model: env.HOUSE_DESIGNER_OPENAI_MODEL } : undefined,
    limits: {
      toolCalls: configured('HOUSE_DESIGNER_AGENT_TOOL_CALLS', defaultAgentLimits.toolCalls, 1, 40),
      evaluations: 1 + configured('HOUSE_DESIGNER_AGENT_CORRECTIONS', defaultAgentLimits.evaluations - 1, 0, 6),
      milliseconds: configured('HOUSE_DESIGNER_AGENT_TIMEOUT_MS', defaultAgentLimits.milliseconds, 500, 110_000),
      modelTurnMilliseconds: configured('HOUSE_DESIGNER_AGENT_TURN_TIMEOUT_MS', defaultAgentLimits.modelTurnMilliseconds, 1000, 110_000),
      inputTokens: configured('HOUSE_DESIGNER_AGENT_INPUT_TOKENS', defaultAgentLimits.inputTokens, 1000, 140_000),
      outputTokens: configured('HOUSE_DESIGNER_AGENT_OUTPUT_TOKENS', defaultAgentLimits.outputTokens, 200, 18_000),
      argumentBytes: configured('HOUSE_DESIGNER_AGENT_ARGUMENT_BYTES', defaultAgentLimits.argumentBytes, 500, 24_000),
    },
  }
}
