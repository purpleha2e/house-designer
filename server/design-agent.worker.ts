import { parentPort, workerData } from 'node:worker_threads'
import type { AgentRequest } from '../src/assistant/architecturalTools.ts'
import { runDesignAgent, type AgentLimits } from './design-agent-loop.ts'
import { mockDesignAgent } from './mock-design-agent.ts'
import { createOpenAiDesignAgent } from './openai-design-agent.ts'

type WorkerInput = { request: AgentRequest; credentials?: { apiKey: string; model: string }; limits: AgentLimits }
const { request, credentials, limits } = workerData as WorkerInput
const port = parentPort!
const provider = request.mode === 'demo' ? mockDesignAgent : credentials ? createOpenAiDesignAgent(credentials.apiKey, credentials.model) : null
// AbortSignal.timeout does not keep a worker alive if a transport drops its
// handles before resolving the pending reply.
port.ref()
try {
  if (!provider) port.postMessage({ type: 'error', text: 'Live AI is unavailable on this server.' })
  else await runDesignAgent(request, provider, new AbortController().signal, event => port.postMessage(event), limits)
} finally { port.close() }
