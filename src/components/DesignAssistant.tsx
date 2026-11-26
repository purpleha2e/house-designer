import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AgentRequestError, availableAgentModes, openAssistantWorker, requestDesignAgent } from '../assistant/assistantClient.ts'
import type { AgentMode, AgentReport, AgentTokenUsage } from '../assistant/architecturalTools.ts'
import { ASSISTANT_PROMPT_LIMIT, mockProvider, type ConversationTurn } from '../assistant/intent.ts'
import type { RevisionGuidance } from '../assistant/layoutPlanner.ts'
import type { DesignOption, DesignProposal, FloorEdits, PlanningResult } from '../assistant/proposal.ts'
import type { SceneSnapshot, SceneSource } from '../assistant/scene.ts'
import type { FloorLevel } from '../types.ts'
import { bounds, transformedFrame } from '../assistant/planGeometry.ts'
import { extensionDesignSteps, readDimensionedExtension, requestsExtensionLayout, requestsSecondStorey } from '../assistant/extensionBrief.ts'
import './DesignAssistant.css'

type ProposalSet = { options: DesignOption[]; floors: FloorLevel[]; revision: string; floorChoice: 'current' | 'upstairs'; extensionBrief?: string }
type AppliedExtension = { brief: string; floorId: string; wallId: string }
type RetryRequest = { prompt: string; history: ConversationTurn[]; mode: AgentMode }
type Preview = (option: DesignOption | null, floors: FloorLevel[], revision: string) => void

type Props = {
  open: boolean
  onClose: () => void
  floors: FloorLevel[]
  revision: string
  captureSource: () => SceneSource
  onPreview: Preview
  onApply: (proposal: DesignProposal, edits: FloorEdits, floors: FloorLevel[]) => boolean
}

const localExample = 'Design the upstairs with three bedrooms, a good-sized bathroom and an airy landing.'
const liveExample = 'Redesign the top floor with three bedrooms and two en suites.'

async function validateOptions(worker: ReturnType<typeof openAssistantWorker>, proposals: DesignProposal[]) {
  const options: DesignOption[] = []
  for (const proposal of proposals.slice(0, 2)) {
    const edits = await worker.run<FloorEdits | null>({ type: 'validate', proposal })
    if (edits) options.push({ proposal, edits })
  }
  return options
}

function ToolDiagnostics({ report }: { report: AgentReport }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  return <details className="design-agent-diagnostics" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Developer diagnostics</summary>
    <p>This request · {report.trace.length} calls · {(report.milliseconds / 1000).toFixed(1)} s · {report.inputTokens.toLocaleString()} input tokens · {report.outputTokens.toLocaleString()} output tokens · {report.stop}</p>
    {report.trace.map((call, index) => <details key={index} onToggle={event => {
      const expanded = event.currentTarget.open
      setSelected(current => expanded ? index : current === index ? null : current)
    }}>
      <summary>{call.tool} · {call.milliseconds} ms{call.result.ok ? '' : ` · ${call.result.code}`}</summary>
      {open && selected === index && <pre>{JSON.stringify({ arguments: call.arguments, result: call.result }, null, 2)}</pre>}
    </details>)}
  </details>
}

export function DesignAssistant(props: Props) {
  const { open, floors, revision } = props
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<ConversationTurn[]>([])
  const [set, setProposals] = useState<ProposalSet | null>(null)
  const [appliedExtension, setAppliedExtension] = useState<AppliedExtension | null>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState<'planning' | 'applying' | null>(null)
  const [modes, setModes] = useState({ demo: false, live: false })
  const [mode, setMode] = useState<'local' | AgentMode>('local')
  const [progress, setProgress] = useState('')
  const [usage, setUsage] = useState<AgentTokenUsage | null>(null)
  const [report, setReport] = useState<AgentReport | null>(null)
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null)
  const pending = useRef<AbortController | null>(null)
  const latest = useRef(props)
  const input = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const stale = !!set && (set.floors !== floors || set.revision !== revision)
  const current = stale ? null : set?.options[selected]?.proposal ?? null
  const stairPreview = current?.method === 'stair-placement'
  const modelPreview = current?.method === 'model-variants'
  const coordinatedPreview = current?.method === 'coordinated'
  const extensionPreview = current?.method === 'extension'
  const upperExtensionPreview = extensionPreview && current.operations[0]?.type === 'extend-above'
  const generalEdit = stairPreview || extensionPreview || modelPreview || current?.method === 'room-redesign' && !current.redesign
  const example = mode === 'live' ? liveExample : localExample
  const extensionFollowUps = mode === 'live' && !current && appliedExtension &&
    floors.some(floor => floor.id === appliedExtension.floorId && floor.walls.some(wall => wall.id === appliedExtension.wallId))
    ? extensionDesignSteps(appliedExtension.brief) : []

  useLayoutEffect(() => { latest.current = props })
  useLayoutEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (!open) return
    input.current?.focus({ preventScroll: true })
    const controller = new AbortController()
    void availableAgentModes(controller.signal).then(available => {
      if (!controller.signal.aborted) setModes(available)
    })
    return () => controller.abort()
  }, [open])
  useEffect(() => {
    const element = transcript.current
    if (element) element.scrollTop = element.scrollHeight
  }, [history, open, busy])

  const append = (text: string) => setHistory(turns => [...turns.slice(-23), { role: 'assistant', text }])
  const choose = (group: ProposalSet, index: number) => {
    const option = group.options[index]
    if (!option) return
    setSelected(index)
    latest.current.onPreview(option, group.floors, group.revision)
  }

  const submit = async (text: string, originalBrief?: string, retriedHistory?: ConversationTurn[]) => {
    if (!text || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy('planning')
    setProgress('Reading the floor and checking layouts…')
    setReport(null)
    setRetryRequest(null)
    setUsage(null)
    setPrompt('')
    input.current?.focus({ preventScroll: true })
    if (!retriedHistory) setHistory(turns => [...turns.slice(-23), { role: 'user', text }])
    const requestHistory = retriedHistory ?? (originalBrief ? [{ role: 'user' as const, text: originalBrief },
      ...history.filter(turn => turn.text !== originalBrief).slice(-5)] : history.slice(-6))
    let signal = AbortSignal.any([controller.signal, AbortSignal.timeout(mode === 'local' ? 28_000 : 115_000)])
    let timeoutMessage = mode === 'local' ? 'The local layout planner reached its time limit.' :
      'The editor timed out waiting for the workspace server to finish replying.'
    let lastAgentPhase = ''
    let worker: ReturnType<typeof openAssistantWorker> | undefined
    try {
      const source = props.captureSource()
      const unchanged = () => latest.current.floors === floors && latest.current.revision === revision
      if (mode !== 'local') {
        const accept = (options: DesignOption[], message: string) => {
          const proposal = options[0].proposal
          const extensionBrief = proposal.method === 'extension' ? proposal.operations[0]?.type === 'extend-above'
            ? appliedExtension?.brief ?? text : current?.method === 'extension' ? set?.extensionBrief ?? text : text : undefined
          const preserve = options.length === 1 && current?.floorId === options[0].proposal.floorId && set?.options.length === 2 &&
            current.method !== 'stair-placement' && options[0].proposal.method !== 'stair-placement' &&
            current.method !== 'extension' && options[0].proposal.method !== 'extension' &&
            current.method !== 'coordinated' && options[0].proposal.method !== 'coordinated' &&
            current.method !== 'model-variants' && options[0].proposal.method !== 'model-variants' &&
            !/\b(start over|new layout|different floor)\b/i.test(text)
          const next = { options: preserve ? set!.options.map((option, index) => index === selected ? options[0] : option) : options,
            floors, revision, floorChoice: 'upstairs' as const, extensionBrief }
          setProposals(next)
          choose(next, preserve ? selected : 0)
          append(mode === 'live' && extensionBrief && extensionDesignSteps(extensionBrief).length
            ? `${message} Apply the footprint to continue with the rooms and stairs from this brief.` : message)
        }
        const fullExtension = mode === 'live' && requestsExtensionLayout(text)
        const dimensioned = !fullExtension && !current && readDimensionedExtension(text)
        const secondStorey = !fullExtension && !dimensioned && requestsSecondStorey(text)
        if (dimensioned || secondStorey) {
          setProgress('Checking the measured extension against the plan…')
          timeoutMessage = 'The editor reached its time limit checking the extension geometry.'
          signal = AbortSignal.any([controller.signal, AbortSignal.timeout(28_000)])
          worker = openAssistantWorker(signal)
          await worker.run<SceneSnapshot>({ type: 'capture', source })
          const result = await worker.run<PlanningResult>(dimensioned ? { type: 'plan-extension', brief: dimensioned } :
            { type: 'plan-second-storey', previous: current, baseWallId: appliedExtension?.wallId })
          const options = await validateOptions(worker, result.proposals)
          if (!unchanged()) { append('The house changed while I was checking the extension. Send the request again to use the latest floor.'); return }
          if (options.length) accept(options, result.message)
          else append(result.proposals.length ? 'The extension did not pass the final editor checks.' : result.message)
          return
        }
        const reply = await requestDesignAgent({ mode, prompt: text, history: requestHistory, source, previous: current }, signal, update => {
          if (pending.current !== controller || signal.aborted) return
          if (update.usage) setUsage(update.usage)
          lastAgentPhase = update.text
          setProgress(update.text)
        })
        signal.throwIfAborted()
        setReport(reply.report)
        if (!unchanged()) { append('The house changed while I was working. Send the request again to use the latest floor.'); return }
        if (reply.proposals.length) {
          signal = AbortSignal.any([controller.signal, AbortSignal.timeout(28_000)])
          timeoutMessage = 'The workspace server finished the layout, but the editor timed out checking the preview.'
          lastAgentPhase = ''
          setProgress('Checking the proposal against the editor…')
          worker = openAssistantWorker(signal)
          await worker.run<SceneSnapshot>({ type: 'capture', source })
          const options = await validateOptions(worker, reply.proposals)
          if (!unchanged()) { append('The house changed while I was checking the proposal. Send the request again to use the latest floor.'); return }
          if (!options.length) { append('The proposals did not pass the final editor checks. Try moving a partition or asking for a smaller change.'); return }
          accept(options, options.length === reply.proposals.length ? reply.message : 'One proposal passed the final editor checks and is available to preview.')
        } else if (reply.selection && set && set.options[reply.selection - 1] && !stale) {
          choose(set, reply.selection - 1)
          append(reply.message)
        } else append(reply.selection ? 'Generate or refresh the layout options before selecting one.' : reply.message)
        return
      }
      worker = openAssistantWorker(signal)
      await worker.run<SceneSnapshot>({ type: 'capture', source })
      const reply = await mockProvider.interpret({ prompt: text, history: history.slice(-6), previous: current?.requirements ?? null,
        previousFloor: current && set ? set.floorChoice : null, options: current && set ? set.options.length : 0 }, signal)
      if (!unchanged()) { append('The house changed while I was working. Send the request again to plan from the latest floor.'); return }
      if (reply.intent === 'select') {
        if (set && reply.selection && reply.selection <= set.options.length && !stale) {
          choose(set, reply.selection - 1)
          append(reply.message || `I’ve selected option ${reply.selection}.`)
        } else append('There isn’t a current option with that number. Generate or refresh a layout first.')
        return
      }
      if (reply.intent !== 'layout') { append(reply.message || 'Tell me what you’d like to change about the upstairs layout.'); return }
      const newLayout = /\b(new layout|start over|different floor|selected floor|this floor)\b/i.test(text)
      const larger = /\b(bigger|larger|good[- ]sized|more\s+(?:room|space)|enlarge|increase|expand)\b/i.test(text)
      const guidance: RevisionGuidance | undefined = current && !newLayout ? {
        previous: current, largerBathroom: larger && /\bbathroom\b/i.test(text),
        largerPrimary: larger && /\b(master|primary|main)\s+bedroom\b/i.test(text), keepLanding: /\bkeep (?:the|this) landing\b/i.test(text),
        moveBedroom: /\b(other|opposite) side\b/i.test(text) || reply.requirements.oppositeBedroom !== current.requirements.oppositeBedroom,
      } : undefined
      const result = await worker.run<PlanningResult>({ type: 'plan', floor: reply.floor, requirements: reply.requirements, revision: guidance })
      const options = await validateOptions(worker, result.proposals)
      if (!unchanged()) { append('The house changed while I was planning. Send the request again to use the latest floor.'); return }
      if (result.proposals.length && !options.length) { append('The proposals did not pass the final editor checks.'); return }
      append(result.message)
      if (options.length) {
        const next = { options, floors, revision, floorChoice: reply.floor }
        setProposals(next)
        choose(next, 0)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof AgentRequestError && error.report) setReport(error.report)
        if (mode !== 'local' && (signal.aborted || (error instanceof AgentRequestError && error.retryable))) {
          setRetryRequest({ prompt: text, history: requestHistory, mode })
        }
        append(error instanceof AgentRequestError ? error.message : signal.aborted
          ? `${timeoutMessage}${lastAgentPhase ? ` The last update was “${lastAgentPhase}”` : ''}`
          : error instanceof Error ? error.message : 'I couldn’t finish that request. Try again.')
      }
    } finally {
      worker?.close()
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) setBusy(null)
      }
    }
  }

  const apply = async () => {
    if (!current || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy('applying')
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    let worker: ReturnType<typeof openAssistantWorker> | undefined
    try {
      worker = openAssistantWorker(signal)
      await worker.run<SceneSnapshot>({ type: 'capture', source: props.captureSource() })
      const edits = await worker.run<FloorEdits | null>({ type: 'validate', proposal: current })
      if (latest.current.floors !== floors || latest.current.revision !== revision) {
        append('The house changed before I could apply this layout. Generate a new preview from the latest floor.'); return
      }
      if (!edits || !latest.current.onApply(current, edits, floors)) {
        append('The layout could not pass the final editor checks. Generate a new preview before applying.'); return
      }
      if (current.method === 'extension' && set?.extensionBrief) {
        const newWall = edits.walls.find(wall => wall.id.startsWith(`${current.id}-lower-wall-`))
        if (newWall) setAppliedExtension({ brief: set.extensionBrief, floorId: current.floorId, wallId: newWall.id })
      }
      setProposals(null)
      append(modelPreview ? 'I applied the model changes. Undo restores the previous models in one step.' :
        current.method === 'stair-placement' ? `I added the staircase to ${current.floorName}. Undo removes the stair and its floor opening in one step.` :
        coordinatedPreview ? current.extensionBasis
          ? 'I applied the extension, rooms and staircase together. Undo reverses the entire design in one step.'
          : 'I applied the rooms and staircase across both floors. Undo reverses the entire layout in one step.' :
        upperExtensionPreview ? 'I added the upper storey above the existing extension. Undo removes the new upper walls, slab and connection in one step.' :
        current.method === 'extension' ? 'I applied the extension. Undo reverses the walls, slabs and connections together.' :
        current.method === 'room-redesign' ? `I applied the redesign to ${current.floorName}. Undo reverses the whole redesign in one step.`
        : `I added the rooms and doors to ${current.floorName}. Undo will remove the entire layout in one step.`)
    } catch (error) {
      if (!controller.signal.aborted) append(signal.aborted ? 'The final geometry check took too long. Try applying the preview again.' :
        error instanceof Error ? error.message : 'I couldn’t apply the layout.')
    } finally {
      worker?.close()
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) setBusy(null)
      }
    }
  }

  if (!open) return null
  return <aside className="design-assistant" aria-label="AI Design Assistant">
    <header className="design-assistant-header">
      <div><h2>AI Design Assistant</h2><p>{floors.find(floor => floor.id === current?.floorId)?.name ?? (mode === 'live' ? 'House design' : 'Upstairs layout')}</p></div>
      <button type="button" className="design-assistant-close" onClick={props.onClose} aria-label="Collapse AI Design Assistant">×</button>
    </header>
    <div className="design-assistant-scroll">
      <div className="design-assistant-messages" ref={transcript} aria-label="Conversation" aria-live="polite">
        {!history.length && <div className="design-assistant-message assistant">
          <p>{mode === 'live' ? 'Tell me which floor to change and what you want to add, move or remove.' :
            'Tell me how you’d like to divide the upstairs. I’ll look for layouts that work with your existing stairs and windows.'}</p>
          <button type="button" className="design-assistant-example" onClick={() => { setPrompt(example); input.current?.focus() }}>{example}</button>
        </div>}
        {history.map((turn, index) => <p key={index} className={`design-assistant-message ${turn.role}`}>{turn.text}</p>)}
        {busy && <p role="status" className="design-assistant-progress">{busy === 'planning' ? progress : 'Checking the layout before applying…'}</p>}
      </div>
      {stale && <p className="design-assistant-stale" role="status">The floor changed. Send a new request to refresh the preview.</p>}
      {current && set && <section className="design-assistant-proposal" aria-label="Layout alternatives">
        <div className="design-assistant-options" role="group" aria-label="Preview a layout">
          {set.options.map(({ proposal: option }, index) => <button key={option.id} type="button" aria-pressed={selected === index}
            disabled={!!busy} onClick={() => choose(set, index)}>{option.narrative?.title ?? (option.priority === 'bedrooms' ? 'Larger bedrooms' : 'Spacious landing')}</button>)}
        </div>
        {current.tradeoff && <p>{current.tradeoff}</p>}
        <p>{modelPreview ? 'Blue marks the doors being changed. The 3D view shows the replacement models.' :
          stairPreview ? 'The stair is shown on the lower floor. Switch to the floor above to see the proposed opening.' :
          coordinatedPreview ? 'Switch between floors to review the rooms, stair approach and landing together before applying.' :
          upperExtensionPreview ? 'Blue shows the new space above the applied extension.' :
          extensionPreview ? set.options[selected].edits.additionalFloors?.length
            ? 'Blue shows the extension. Switch between the two floors to review it before applying.'
            : 'Blue shows the extension and its connection to the existing floor.' :
          'The existing plan is faded. Blue marks new or moved walls and doors, red dashes mark removals, and teal marks new windows.'}</p>
        {!generalEdit && <dl className="design-assistant-metrics">
          <div><dt>Bedrooms</dt><dd>{current.metrics.bedroomArea.toFixed(1)} m²</dd></div>
          {(!current.redesign || current.redesign.sharedBathroomId) && <div>
            <dt>{current.redesign?.home ? 'Family bathroom' : current.redesign ? 'Shared bathroom' : 'Bathroom'}</dt><dd>{current.metrics.bathroomArea.toFixed(1)} m²</dd>
          </div>}
          <div><dt>{current.redesign?.home ? 'Hallway' : 'Landing'}</dt><dd>{current.metrics.landingArea.toFixed(1)} m²</dd></div>
        </dl>}
        <details>
          <summary>{generalEdit ? 'Geometry validation' : 'Access, daylight and validation'}</summary>
          {current.redesign && <p>{current.redesign.ensuites.length} private en suites. Each bedroom has its own entrance from the {current.redesign.home ? 'hallway' : 'landing'}{current.redesign.sharedBathroomId && ', as does the shared bathroom'}.</p>}
          {!generalEdit && current.method !== 'room-redesign' && !coordinatedPreview && <p>{current.metrics.circulationWidth.toFixed(2)} m clear route from the stair.</p>}
          {!generalEdit && <p>{current.metrics.daylitBedrooms} of {current.requirements.bedrooms} bedrooms have an exterior window.</p>}
          {!extensionPreview && !coordinatedPreview && !modelPreview && <p>Preserves {current.preserved.wallIds.length} existing walls and {current.preserved.openingIds.length} openings{current.stairId && ', including the stair layout'}.</p>}
          {current.assumptions.map(item => <p key={item}>{item}</p>)}
          <ul>{current.validation.checks.map(item => <li key={item}>{item}</li>)}</ul>
        </details>
        {!stairPreview && !extensionPreview && !modelPreview && <details>
          <summary>Individual rooms and trade-offs</summary>
          <ul>{[...current.rooms, ...Object.values(set.options[selected].edits.overlays ?? {}).flatMap(floor => floor.rooms)].map(room => {
            const box = bounds(room.polygon.map(transformedFrame(current.layoutAxis).local))
            return <li key={room.id}>{room.name} · {room.area.toFixed(1)} m² · {(box.maxX - box.minX).toFixed(1)} × {(box.maxY - box.minY).toFixed(1)} m</li>
          })}</ul>
          {current.narrative?.advantages.map(text => <p key={text}>Advantage · {text}</p>)}
          {current.narrative?.compromises.map(text => <p key={text}>Compromise · {text}</p>)}
        </details>}
        <ul className="design-assistant-warnings">{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <div className="design-assistant-actions">
          <button type="button" className="design-assistant-primary" disabled={!!busy} onClick={() => { void apply() }}>{modelPreview ? 'Apply model changes' : stairPreview ? 'Apply staircase' : extensionPreview ? 'Apply extension' : current.extensionBasis ? 'Apply design' : 'Apply layout'}</button>
          <button type="button" disabled={!!busy} onClick={() => input.current?.focus()}>Revise</button>
          <button type="button" disabled={!!busy} onClick={() => {
            setProposals(null); props.onPreview(null, floors, revision); append('I discarded the preview. Tell me what you’d like to try next.')
          }}>Discard</button>
        </div>
      </section>}
      {report && <ToolDiagnostics report={report} />}
      {!!extensionFollowUps.length && <section className="design-assistant-proposal" aria-label="Continue the extension design">
        <p>Continue with your original brief</p>
        <div className="design-assistant-actions">
          {extensionFollowUps.map(step => <button key={step.label} type="button" disabled={!!busy}
            onClick={() => { void submit(step.prompt, appliedExtension?.brief) }}>{step.label}</button>)}
        </div>
      </section>}
    </div>
    <form onSubmit={event => { event.preventDefault(); void submit(prompt.trim()) }} className="design-assistant-form">
      {mode === 'live' && usage && <div className="design-assistant-token-usage" role="status" aria-label="Token usage">
        <dl>
          <div><dt>Input tokens</dt><dd>{usage.inputTokens.toLocaleString()} / {usage.inputTokenLimit.toLocaleString()}</dd></div>
          <div><dt>Output tokens</dt><dd>{usage.outputTokens.toLocaleString()} / {usage.outputTokenLimit.toLocaleString()}</dd></div>
        </dl>
      </div>}
      <label htmlFor="design-assistant-request">{current ? 'Ask for a change' : 'Describe your layout'}</label>
      <textarea id="design-assistant-request" ref={input} value={prompt} onChange={event => setPrompt(event.target.value)}
        maxLength={ASSISTANT_PROMPT_LIMIT} rows={3} placeholder={current ? 'Could you make the bathroom bigger?' : 'Three bedrooms, a bathroom and a landing…'}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
        }} />
      <div className="design-assistant-send">
        {(modes.demo || modes.live || mode !== 'local') && <label className="design-assistant-provider" title="Live AI sends the request and architectural tool results to the configured model">
          Mode <select aria-label="Assistant mode" value={mode} disabled={!!busy} onChange={event => setMode(event.target.value as typeof mode)}>
            <option value="local">Local planner</option>
            <option value="demo" disabled={!modes.demo}>Local agent demo</option>
            {(modes.live || mode === 'live') && <option value="live" disabled={!modes.live}>Live AI agent</option>}
          </select>
        </label>}
        {busy === 'planning' && <button type="button" onClick={() => {
          pending.current?.abort(); pending.current = null; setBusy(null); append('I stopped working on that request.')
        }}>Cancel</button>}
        {!busy && retryRequest?.mode === mode && <button type="button" onClick={() => {
          void submit(retryRequest.prompt, undefined, retryRequest.history)
        }}>Retry request</button>}
        <button className="design-assistant-primary" type="submit" disabled={!!busy || !prompt.trim()}>Send</button>
      </div>
    </form>
  </aside>
}
