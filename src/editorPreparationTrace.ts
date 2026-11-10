type PreparationEvent = { stage: string; generation: number; at: number; detail?: Record<string, unknown> }
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('editorTrace')
export const editorPreparationEvents: PreparationEvent[] = []
export function editorPreparationTime() { return performance.now() }
/** Opt-in User Timing records share project IDs with the UI publication fence.
 * No scene traversal, driver queries or retained geometry in this trace. */
export function traceEditorPreparation(stage: string, generation: number, detail?: Record<string, unknown>) {
  if (!enabled) return
  const event = { stage, generation, at: performance.now(), detail }
  editorPreparationEvents.push(event)
  if (editorPreparationEvents.length > 1000) editorPreparationEvents.shift()
  performance.mark(`extaplan:${stage}`, { detail: event })
  performance.clearMarks(`extaplan:${stage}`)
}
