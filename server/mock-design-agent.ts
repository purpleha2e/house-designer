import { asRecord, mockProvider, type Requirements } from '../src/assistant/intent.ts'
import type { Point } from '../src/types.ts'
import type { ToolArguments, ToolCall, ToolName, ToolResult } from '../src/assistant/architecturalTools.ts'
import { distance, pointInPolygon, projection } from '../src/assistant/planGeometry.ts'
import type { AgentProvider, AgentTurn } from './design-agent-loop.ts'

type Reply = Pick<AgentTurn, 'message' | 'selection'>
type Program = AsyncGenerator<ToolCall, Reply, ToolResult | undefined>
type Option = { id: string; priority: 'bedrooms' | 'landing'; metrics: { bedroomArea: number; landingArea: number; bathroomArea: number } }
type DraftInfo = { draftId: string; walls: Array<{ id: string; start: Point; end: Point }>; doors: Array<{ wallId: string; roomId: string }>;
  rooms: Array<{ id: string; name: string; function: string; outline: Point[]; area: number }> }

const value = <T>(result: ToolResult | undefined) => result?.ok ? result.value as T : undefined
const publishText = (option: Option) => ({ draftId: option.id, title: option.priority === 'bedrooms' ? 'Larger bedrooms' : 'Spacious landing',
  explanation: `This option gives ${option.metrics.bedroomArea.toFixed(1)} m² to bedrooms and ${option.metrics.landingArea.toFixed(1)} m² to the landing.`,
  advantages: ['Keeps access to the rooms from the existing stair.'], compromises: ['The landing and bedrooms share the same enclosed floor area.'] })

export const mockDesignAgent: AgentProvider = {
  start(input) {
    let sequence = 0
    const call = <N extends ToolName>(name: N, args: ToolArguments<N>): ToolCall => ({ name, args: JSON.stringify(args), id: `demo-${++sequence}` })
    const prior = input.context.activeProposal

    async function* revise(requirements: Requirements): Program {
      if (!prior) return { message: 'Select a proposal to revise first.' }
      const started = yield call('begin_design', { floorId: prior.floorId, baseId: prior.id, priority: prior.priority, requirements })
      const draft = value<DraftInfo>(started)
      if (!draft) return { message: started?.ok === false ? started.message : 'I could not open the previous proposal.' }
      const keepLanding = /keep the (?:larger )?landing/i.test(input.prompt)
      const smaller = /\b(smaller|reduce|less space)\b/i.test(input.prompt)
      const target = /\b(landing|corridor)\b/i.test(input.prompt) && !keepLanding ? 'landing' :
        /bathroom/i.test(input.prompt) ? 'bathroom' : 'bedroom'
      const number = input.prompt.match(/\bbedroom (\d|one|two|three|four)\b/i)?.[1]?.toLowerCase()
      const roomNumber = number ? ({ one: '1', two: '2', three: '3', four: '4' } as Record<string, string>)[number] ?? number : undefined
      const room = draft.rooms.find(room => room.function === target && (!roomNumber || target !== 'bedroom' || room.name?.endsWith(` ${roomNumber}`)))
      if (!room) return { message: 'The requested room could not be found in the active proposal.' }
      const walls = draft.walls.flatMap(wall => {
        const gap = Math.min(...room.outline.map(point => projection(point, wall.start, wall.end).gap))
        if (gap >= 0.13) return []
        const doors = draft.doors.filter(door => door.wallId === wall.id)
        const eligible = target === 'landing' ? doors.length > 0 : !doors.length || !keepLanding && doors.some(door => door.roomId === room.id)
        return eligible ? [{ wall, doors: doors.length }] : []
      }).sort((a, b) => a.doors - b.doors || distance(b.wall.start, b.wall.end) - distance(a.wall.start, a.wall.end))
      const baseline = value<{ rooms: Array<{ id: string; area: number }> }>(yield call('evaluate_layout', { draftId: draft.draftId }))
      const previousArea = baseline?.rooms.find(item => item.id === room.id)?.area ?? room.area
      for (const { wall } of walls.slice(0, 2)) {
        const len = distance(wall.start, wall.end), dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y
        const midpoint = { x: wall.start.x + dx / 2, y: wall.start.y + dy / 2 }
        const normal = { x: -dy / len, y: dx / len }
        const across = pointInPolygon({ x: midpoint.x + normal.x * 0.12, y: midpoint.y + normal.y * 0.12 }, room.outline)
        const shift = (across ? -1 : 1) * (smaller ? -0.28 : 0.28)
        const translate = (point: Point) => ({ x: point.x + normal.x * shift, y: point.y + normal.y * shift })
        const moved = yield call('move_partition_wall', { draftId: draft.draftId, wallId: wall.id, start: translate(wall.start), end: translate(wall.end) })
        if (!moved?.ok) continue
        const checked = yield call('evaluate_layout', { draftId: draft.draftId })
        const report = value<{ valid: boolean; rooms: Array<{ id: string; area: number }>; metrics?: Option['metrics'] }>(checked)
        const now = report?.rooms.find(item => item.id === room.id)?.area
        if (report?.valid && now !== undefined && (smaller ? previousArea - now : now - previousArea) > 0.1) {
          const published = yield call('publish_design', { draftId: draft.draftId, title: `${smaller ? 'Smaller' : 'Larger'} ${target}`,
            explanation: `The measured ${room.name ?? target} changes from ${previousArea.toFixed(1)} to ${now.toFixed(1)} m².`,
            advantages: ['Keeps the surrounding layout and checks the doors and stair access again.'], compromises: ['Moving the partition reallocates some floor area between adjacent spaces.'] })
          if (published?.ok) return { message: `The revised ${room.name ?? target} has ${now.toFixed(1)} m². Check the new preview against your priorities.` }
        }
        yield call('move_partition_wall', { draftId: draft.draftId, wallId: wall.id, start: wall.start, end: wall.end })
      }
      return { message: `I could not ${smaller ? 'reduce' : 'enlarge'} the ${target} in this demonstration while preserving access. The previous preview is available.` }
    }

    async function* program(): Program {
      const overview = yield call('get_project_overview', {})
      const summary = value<{ levels: Array<{ id: string; elevation: number }>; selectedFloorId: string }>(overview)
      const levels = summary?.levels.toSorted((a, b) => a.elevation - b.elevation) ?? []
      const selected = levels.find(level => level.id === summary?.selectedFloorId && level.elevation > levels[0]?.elevation + 0.001)
      const floor = selected ?? levels.find(level => level.elevation > levels[0]?.elevation + 0.001)
      const parsed = await mockProvider.interpret({ prompt: input.prompt, history: input.history, previous: prior?.requirements ?? null,
        previousFloor: prior ? 'upstairs' : null, options: prior ? 2 : 0 })
      if (parsed.intent === 'extension') {
        if (levels[0]) yield call('get_floor_layout', { floorId: levels[0].id, draftId: null })
        return { message: `${parsed.message} The measured ground-floor outline can guide a conceptual connection once the rear wall is identified.` }
      }
      if (parsed.intent === 'select') return { message: parsed.message, selection: parsed.selection }
      if (prior && /larger|bigger|smaller|reduce|open it up|cramped|more space|less space/i.test(input.prompt)) return yield* revise(parsed.requirements)
      if (parsed.intent !== 'layout') return { message: parsed.message }
      if (!floor || parsed.floor === 'current' && !selected) return { message: 'Choose an existing upper floor with a stair before starting this layout.' }
      yield call('get_floor_layout', { floorId: floor.id, draftId: null })
      yield call('get_constraints', { floorId: floor.id })
      const candidates = yield call('request_layout_candidates', { floorId: floor.id, requirements: parsed.requirements })
      const options = value<{ options: Option[]; message: string }>(candidates)
      for (const option of options?.options ?? []) yield call('publish_design', publishText(option))
      const result = asRecord(candidates?.ok === false ? candidates : null)
      return { message: options?.message ?? String(result?.message ?? 'I could not produce a layout from the floor’s current geometry.') }
    }

    const actions = program()
    return {
      async next(outputs, signal) {
        signal.throwIfAborted()
        const step = await actions.next(outputs[0]?.result)
        return step.done ? { calls: [], ...step.value } : { calls: [step.value] }
      },
    }
  },
}
