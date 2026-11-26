import { architecturalTools, isToolName, type AgentEvent, type AgentReport, type AgentRequest, type ToolArguments, type ToolCall, type ToolResult, toolError, validToolArguments } from '../src/assistant/architecturalTools.ts'
import { createAgentWorkspace } from '../src/assistant/agentWorkspace.ts'
import { readDimensionedExtension, requestsExtensionLayout, requestsSecondStorey } from '../src/assistant/extensionBrief.ts'
import { planDimensionedExtension, planSecondStorey, stageExtension } from '../src/assistant/extensionPlacement.ts'
import { captureArchitecturalScene, type SceneSource } from '../src/assistant/scene.ts'
import { missingCoordinatedRooms, requestsCoordinatedLayout } from '../src/assistant/coordinatedIntent.ts'
import type { DesignProposal, ExtensionBasis } from '../src/assistant/proposal.ts'
import { abortable } from '../src/assistant/abortable.ts'
import { requestsModelVariants } from '../src/assistant/modelVariants.ts'

export type AgentContext = ReturnType<typeof createAgentWorkspace>['context'] & { extensionStage?: 'footprint' | 'interior' }
export type ToolOutput = { id: string; result: ToolResult }
export type AgentTurn = { calls: ToolCall[]; message?: string; selection?: number | null; inputTokens?: number; outputTokens?: number;
  limit?: 'model response token limit' }
export interface AgentSession { next(outputs: ToolOutput[], signal: AbortSignal, remainingOutputTokens: number): Promise<AgentTurn> }
export interface AgentProvider {
  start(input: { prompt: string; history: AgentRequest['history']; context: AgentContext }): AgentSession
}

export type AgentLimits = { toolCalls: number; evaluations: number; milliseconds: number; modelTurnMilliseconds: number; inputTokens: number; outputTokens: number; argumentBytes: number }
export const defaultAgentLimits: AgentLimits = { toolCalls: 20, evaluations: 4, milliseconds: 85_000, modelTurnMilliseconds: 45_000,
  inputTokens: 75_000, outputTokens: 7_000, argumentBytes: 9_000 }

function boundedResult(result: ToolResult) {
  return Buffer.byteLength(JSON.stringify(result)) <= 34_000 ? result :
    toolError('result_limit', 'That result is too large to return at once. Inspect individual walls or rooms and use the project overview.')
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, ordered(item)]))
  return value
}

function phaseFor(name: string) {
  if (name === 'find_model_variants') return 'Looking up compatible models…'
  if (name === 'propose_model_variants') return 'Checking the model replacements against the existing openings…'
  if (name === 'evaluate_layout') return 'Checking room sizes and access…'
  if (name === 'propose_staircase') return 'Checking staircase fit and access on both floors…'
  if (name === 'compose_two_storey_layout') return 'Checking both floor layouts, access and the staircase together…'
  if (name === 'propose_extension') return 'Checking the extension footprint and access…'
  if (name === 'publish_design' || name === 'compose_floor_layout') return 'Preparing the validated preview…'
  if (name === 'request_layout_candidates') return 'Comparing potential arrangements…'
  if (name.startsWith('move_') || name.startsWith('remove_')) return 'Refining the selected layout…'
  if (isToolName(name) && architecturalTools[name].category === 'draft') return 'Editing a temporary layout…'
  return 'Inspecting the house and its constraints…'
}

function windowExclusionIn(prompt: string) {
  const side = prompt.match(/\bno windows?\b[^.!?\n]*?\b(?:on|along)\s+(?:the\s+)?(left|right)\b/i)?.[1]?.toLowerCase()
  return side === 'left' || side === 'right' ? side : undefined
}

function existingRoomBrief(prompt: string) {
  const normalized = prompt.trim().replace(/^["“]|["”]$/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/en[-\u2010-\u2013 ]suite/g, 'ensuite')
    .replace(/^(?:could|can) you see what it would look like with\s+/, '')
    .replace(/^design\s+/, '')
  // Match the entire brief so extra design instructions still reach the model.
  const match = normalized.match(/^([1-4]|one|two|three|four) bedrooms? upstairs[.,]\s*([1-2]|one|two) (?:of them )?with (?:an )?ensuites?(?:[.,]\s*(bathrooms(?:\/ensuites)? can have a window if they are on the left side))?[.!?]*$/)
  if (!match) return null
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 }
  return { bedrooms: counts[match[1]] ?? Number(match[1]), ensuites: counts[match[2]] ?? Number(match[2]),
    leftBathroomWindows: !!match[3] }
}

function reusableRoomBrief(input: AgentRequest) {
  if (input.mode !== 'live' || input.previous) return null
  const brief = existingRoomBrief(input.prompt)
  if (!brief) return null
  const compatible = input.history.every(turn => {
    if (turn.role === 'assistant') return true
    const earlier = existingRoomBrief(turn.text)
    return earlier?.bedrooms === brief.bedrooms && earlier.ensuites === brief.ensuites &&
      earlier.leftBathroomWindows === brief.leftBathroomWindows
  })
  return compatible ? brief : null
}

/** All architectural operations run against one request's private workspace. */
export async function runDesignAgent(input: AgentRequest, provider: AgentProvider, signal: AbortSignal,
  emit: (event: AgentEvent) => void, limits: AgentLimits = defaultAgentLimits) {
  const started = performance.now()
  const report: AgentReport = { trace: [], milliseconds: 0, inputTokens: 0, outputTokens: 0, stop: 'completed' }
  const finish = () => { report.milliseconds = Math.round(performance.now() - started); return report }
  let progressText = 'Reading the current architectural model…'
  const progress = (text: string, showUsage = false) => {
    progressText = text
    emit({ type: 'phase', text, usage: showUsage && input.mode === 'live' ? {
      inputTokens: report.inputTokens, outputTokens: report.outputTokens,
      inputTokenLimit: limits.inputTokens, outputTokenLimit: limits.outputTokens,
    } : undefined })
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(limits.milliseconds)])
  let workspace: ReturnType<typeof createAgentWorkspace> | undefined
  let waitingForOpenAi = false
  let modelDeadline: AbortSignal | undefined
  const modelVariants = input.mode === 'live' && requestsModelVariants(input.prompt)
  const coordinated = input.mode === 'live' && !modelVariants && (!!input.previous?.coordinated || requestsCoordinatedLayout(input.prompt))
  const fullExtension = input.mode === 'live' && !modelVariants && requestsExtensionLayout(input.prompt)
  const measuredExtension = !modelVariants && (fullExtension || !input.previous) && readDimensionedExtension(input.prompt)
  let extensionStage: AgentContext['extensionStage'] = fullExtension && !measuredExtension ? 'footprint' : undefined
  let basis: ExtensionBasis | undefined = fullExtension || modelVariants ? undefined : input.previous?.extensionBasis
  const proposed = () => (workspace?.proposals() ?? []).flatMap(proposal =>
    coordinated && proposal.method !== 'coordinated' ? [] : [basis && proposal.method === 'coordinated' ? { ...proposal, extensionBasis: basis } : proposal])
  const setBasis = (proposal: DesignProposal | undefined) => {
    const operation = proposal?.operations[0]
    if (proposal?.method !== 'extension' || (operation?.type !== 'add-extension' && operation?.type !== 'extend-above')) return false
    basis = { floorId: proposal.floorId, operation }
    extensionStage = 'interior'
    return true
  }
  const createWorkspace = (source: SceneSource, previous: DesignProposal | null) => createAgentWorkspace(source, previous, limits.evaluations,
    input.mode === 'live' ? windowExclusionIn(input.prompt) : undefined,
    input.mode === 'live' ? input.history.filter(turn => turn.role === 'user')
      .map(turn => windowExclusionIn(turn.text)).findLast(side => side !== undefined) : undefined)
  try {
    deadline.throwIfAborted()
    progress(progressText, true)
    const secondStorey = !modelVariants && !measuredExtension && requestsSecondStorey(input.prompt)
    if (measuredExtension || secondStorey) {
      progress('Checking the measured extension against the plan…')
      const scene = captureArchitecturalScene(input.source)
      const { proposals, message, alreadyApplied } = measuredExtension ? planDimensionedExtension(input.source, scene, measuredExtension) :
        planSecondStorey(input.source, scene, input.previous)
      deadline.throwIfAborted()
      if (!(fullExtension && (alreadyApplied || setBasis(proposals[0])))) {
        emit({ type: 'result', result: { proposals, message, selection: null, report: finish() } })
        return
      }
      extensionStage = 'interior'
      progress('Designing rooms and stairs inside the proposed extension…')
    }
    const working = basis ? stageExtension(input.source, basis) : input.source
    if (!working) throw new Error('The proposed footprint could not be recreated. Check the exterior walls and try again.')
    if (basis) extensionStage = 'interior'
    const previous = fullExtension || modelVariants && input.previous?.method !== 'model-variants' ? null : input.previous && { ...input.previous, extensionBasis: undefined }
    workspace = createWorkspace(working, previous)
    const brief = modelVariants ? null : reusableRoomBrief(input)
    if (brief) {
      const { levels, selection } = workspace.context
      const ground = Math.min(...levels.map(level => level.elevation))
      const upper = levels.filter(level => level.elevation > ground && level.stairArrivals === 1 &&
        level.roomCount >= brief.bedrooms + brief.ensuites + (brief.bedrooms > brief.ensuites ? 2 : 1))
      const target = upper.find(level => level.id === selection.floorId) ?? (upper.length === 1 ? upper[0] : undefined)
      if (target) {
        progress('Checking whether the existing rooms can fit the brief…')
        const clock = performance.now()
        const args = { ...brief, floorId: target.id }
        const result = workspace.execute('reuse_existing_rooms', args)
        report.trace.push({ tool: 'reuse_existing_rooms', arguments: args, result, milliseconds: Math.round(performance.now() - clock) })
        const [proposal] = workspace.proposals()
        if (proposal) {
          deadline.throwIfAborted()
          const message = `${proposal.narrative!.title} on ${proposal.floorName}. ${proposal.narrative!.explanation} One validated preview is available.`
          emit({ type: 'result', result: { proposals: [proposal], message, selection: null, report: finish() } })
          return
        }
      }
    }
    const startModel = (context: AgentContext) => provider.start({ prompt: input.prompt, history: input.history, context: { ...context, extensionStage } })
    let model = startModel(workspace.context)
    const roomBrief = /\boriginal brief\b/i.test(input.prompt) ? input.history.find(turn => turn.role === 'user')?.text ?? input.prompt : input.prompt
    let outputs: ToolOutput[] = []
    let message = '', selection: number | null = null
    const seenIds = new Set<string>()
    const repeated = new Map<string, number>()
    let attemptedDesign = false
    let layoutFinding = ''

    for (;;) {
      deadline.throwIfAborted()
      if (report.inputTokens >= limits.inputTokens) { report.stop = 'input token budget'; break }
      if (report.outputTokens >= limits.outputTokens) { report.stop = 'output token budget'; break }
      if (input.mode === 'live') {
        waitingForOpenAi = true
        progress('Waiting for OpenAI…')
        modelDeadline = AbortSignal.timeout(limits.modelTurnMilliseconds)
      }
      const turnSignal = modelDeadline ? AbortSignal.any([deadline, modelDeadline]) : deadline
      const turn = await abortable(() => model.next(outputs, turnSignal, limits.outputTokens - report.outputTokens), turnSignal)
      deadline.throwIfAborted()
      waitingForOpenAi = false
      modelDeadline = undefined
      report.inputTokens += turn.inputTokens ?? 0
      report.outputTokens += turn.outputTokens ?? 0
      if (input.mode === 'live' && (turn.inputTokens || turn.outputTokens)) progress(progressText, true)
      if (report.inputTokens > limits.inputTokens) { report.stop = 'input token budget'; break }
      if (report.outputTokens > limits.outputTokens) { report.stop = 'output token budget'; break }
      if (turn.limit) { report.stop = turn.limit; break }
      if (!turn.calls.length) {
        message = turn.message?.trim().slice(0, 1200) ?? ''
        selection = turn.selection === 1 || turn.selection === 2 ? turn.selection : null
        break
      }
      if (report.trace.length + turn.calls.length > limits.toolCalls) { report.stop = 'tool-call budget'; break }
      outputs = []
      let completedLayout = false
      for (const call of turn.calls) {
        deadline.throwIfAborted()
        const callStart = performance.now()
        let args: unknown, result: ToolResult
        const phase = phaseFor(call.name)
        if (phase !== progressText) progress(phase)
        if (seenIds.has(call.id)) throw new Error('The model repeated a tool response identifier. Try the request again.')
        seenIds.add(call.id)
        if (Buffer.byteLength(call.args) <= limits.argumentBytes) {
          try { args = JSON.parse(call.args) } catch { /* Replied to as a structured tool error. */ }
        }
        if (!isToolName(call.name) || !validToolArguments(call.name, args)) {
          result = toolError('invalid_arguments', 'Use a named architectural tool and provide its required typed arguments within the size limit.')
          args = null
        } else if (coordinated && architecturalTools[call.name].category === 'draft' &&
            call.name !== (extensionStage === 'footprint' ? 'propose_extension' : 'compose_two_storey_layout')) {
          layoutFinding = extensionStage === 'footprint' ? 'Resolve the extension footprint first using propose_extension.' :
            'Submit both room layouts and the staircase together using compose_two_storey_layout.'
          result = toolError('coordinated_scope', layoutFinding)
          attemptedDesign = true
        } else {
          attemptedDesign ||= architecturalTools[call.name].category === 'draft'
          const signature = `${call.name}:${JSON.stringify(ordered(args))}`
          const repetitions = (repeated.get(signature) ?? 0) + 1
          repeated.set(signature, repetitions)
          if (repetitions > 3) { report.stop = 'repeated calls'; break }
          const missing = call.name === 'compose_two_storey_layout'
            ? missingCoordinatedRooms(roomBrief, args as ToolArguments<'compose_two_storey_layout'>) : []
          result = missing.length ? toolError('room_schedule', `The brief also requires ${missing.join(', ')}. Include those rooms in the coordinated layout.`) :
            boundedResult(workspace.execute(call.name, args))
        }
        outputs.push({ id: call.id, result })
        report.trace.push({ tool: isToolName(call.name) ? call.name : 'unknown tool', arguments: args,
          result, milliseconds: Math.round(performance.now() - callStart) })
        if (call.name === 'compose_floor_layout' || call.name === 'propose_staircase' || call.name === 'propose_extension' || call.name === 'compose_two_storey_layout' || call.name === 'propose_model_variants') {
          if (result.ok) {
            if (call.name === 'propose_extension' && extensionStage === 'footprint') {
              if (!setBasis(workspace.proposals().at(-1)) || !basis) throw new Error('The extension draft could not be prepared for the room layout.')
              const draft = stageExtension(input.source, basis)
              if (!draft) throw new Error('The proposed footprint could not be recreated for the room layout.')
              progress('Designing rooms and stairs inside the proposed extension…')
              workspace = createWorkspace(draft, null)
              model = startModel(workspace.context)
              outputs = []
              seenIds.clear()
              layoutFinding = ''
              break
            }
            const ready = workspace.proposals().at(-1)?.narrative
            message = ready ? `${ready.title}. ${ready.explanation}` : ''
            completedLayout = true
            break
          }
          layoutFinding = result.message
        }
      }
      if (completedLayout || report.stop !== 'completed') break
    }
    const proposals = proposed()
    if (report.stop !== 'completed') {
      message = proposals.length ? `I reached the ${report.stop}. You can review the validated ${proposals.length === 1 ? 'option' : 'options'} I completed.` :
        `I reached the ${report.stop} before a preview was ready.${layoutFinding ? ` ${layoutFinding}` : ''}`
    } else if (!proposals.length && attemptedDesign && !selection) {
      message = ['I haven’t validated a new layout.', message || layoutFinding || 'Check the reported constraints or try a smaller change.'].join(' ')
    }
    if (proposals.length === 1 && report.stop === 'completed') message = `${message || 'One option passed the editor checks.'} One validated preview is available.`
    if (!message) message = proposals.length ? 'The validated layouts are ready to preview.' : 'Tell me more about the floor or the change you want to try.'
    emit({ type: 'result', result: { proposals, message, selection, report: finish() } })
  } catch (error) {
    if (signal.aborted) return
    const providerTimedOut = waitingForOpenAi && !!modelDeadline?.aborted && !deadline.aborted
    const timedOut = deadline.aborted || providerTimedOut
    report.stop = providerTimedOut ? 'OpenAI turn timeout' : deadline.aborted ? 'timeout' : 'error'
    const proposals = timedOut ? proposed() : []
    if (proposals.length) {
      emit({ type: 'result', result: { proposals, message: 'I reached the time limit. The validated layout is available to preview.',
        selection: null, report: finish() } })
      return
    }
    const timeout = providerTimedOut ? `OpenAI did not finish its reply within ${limits.modelTurnMilliseconds / 1000} seconds.` :
      waitingForOpenAi ? 'The design agent reached its time limit while waiting for OpenAI.' : 'The design agent reached its time limit while checking the layout.'
    emit({ type: 'error', text: timedOut ? timeout :
      error instanceof Error ? error.message : 'The agent could not complete this request.', report: finish(), ...(timedOut && { retryable: true }) })
  }
}
