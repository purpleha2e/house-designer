import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import test from 'node:test'
import type { AgentEvent, AgentRequest, ToolArguments, ToolCall, ToolName, ToolResult } from '../src/assistant/architecturalTools.ts'
import { AgentRequestError, requestDesignAgent } from '../src/assistant/assistantClient.ts'
import { captureArchitecturalScene, makeSceneSource, ASSISTANT_DOOR_MODEL, ASSISTANT_EXTERIOR_DOOR_MODELS, ASSISTANT_WINDOW_MODEL } from '../src/assistant/scene.ts'
import { BIFOLD_DOOR_MODELS } from '../src/assistant/modelVariants.ts'
import { validateAndMaterialize } from '../src/assistant/layoutValidation.ts'
import { area, bounds, pointInPolygon, polygon, projection } from '../src/assistant/planGeometry.ts'
import { validateProposal } from '../src/assistant/proposalValidation.ts'
import { stageExtension } from '../src/assistant/extensionPlacement.ts'
import { materializeFloorEdits, materializeProposalFloors } from '../src/assistant/proposal.ts'
import { openingConnections } from '../src/assistant/roomRedesign.ts'
import { getStairLandingPosition } from '../src/stairLandings.ts'
import { defaultAgentLimits, runDesignAgent, type AgentProvider, type AgentTurn } from '../server/design-agent-loop.ts'
import { createOpenAiDesignAgent } from '../server/openai-design-agent.ts'
import { parseAgentRequest } from '../server/design-agent-input.ts'
import { mockDesignAgent } from '../server/mock-design-agent.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel, Point, Wall } from '../src/types.ts'

const door: ModelDefinition = { id: ASSISTANT_DOOR_MODEL, name: 'Panel door', category: 'Doors', color: 'white',
  shape: 'box', wallMount: 'interior-door', width: 0.975141, openingWidth: 0.975141, height: 2.124037, depth: 0.2 }
const stairs: ModelDefinition = { id: 'test-stairs', name: 'Stairs', category: 'Stairs', color: 'white',
  shape: 'box', objectType: 'stairs', width: 0.9, height: 2.7, depth: 2.8 }
const window: ModelDefinition = { id: ASSISTANT_WINDOW_MODEL, name: 'Single-pane window', category: 'Windows', color: 'white',
  shape: 'box', wallMount: 'window', width: 1.8, openingWidth: 1.8, openingCenterOffset: 0, height: 2, depth: 0.08 }
const frontDoor: ModelDefinition = { ...door, id: ASSISTANT_EXTERIOR_DOOR_MODELS.front,
  name: 'Front door', wallMount: 'exterior-door', width: 0.97, openingWidth: 0.97, height: 2.1 }
const patioDoor: ModelDefinition = { ...door, id: ASSISTANT_EXTERIOR_DOOR_MODELS.patio,
  name: 'Bifold patio door', wallMount: 'patio-door', width: 2.4, openingWidth: 2.4, height: 2.08 }
const requirements = { bedrooms: 3, bathrooms: 1, landing: 'spacious', bathroom: 'larger', primaryBedroom: 'standard', oppositeBedroom: null } as const
const point = (x: number, y: number) => ({ x, y })
const wall = (a: number, b: number, c: number, d: number) => ({ start: point(a, b), end: point(c, d) })
const fixture = (width = 12, depth = 10): AgentRequest => {
  const walls: Wall[] = [wall(0, 0, width, 0), wall(width, 0, width, depth), wall(width, depth, 0, depth), wall(0, depth, 0, 0)]
    .map((geometry, index) => ({ ...geometry, id: `outer-${index}`, kind: 'external', thickness: 0.3, height: 2.45 }))
  if (width > 10) walls[0].openings = [{ id: 'window-1', modelId: 'window', center: 2.1, width: 1.2, height: 1, bottom: 0.9 }]
  const upper: FloorLevel = { id: 'upstairs', name: 'First floor', elevation: 2.7, walls, rooms: [], models: [], roomHeight: 2.45, slabThickness: 0.25 }
  const lower: FloorLevel = { ...upper, id: 'ground', name: 'Ground floor', elevation: 0, walls: walls.map(item => ({ ...item, openings: [] })), models: [
    { id: 'stair-id', modelId: stairs.id, position: point(width * 0.4, depth / 2), scale: 1, rotation: -Math.PI / 2 },
  ] }
  return { mode: 'demo', prompt: 'Design three bedrooms, a good-sized bathroom and an airy landing upstairs.', history: [], previous: null,
    source: makeSceneSource({ floors: [lower, upper], models: new Map([[door.id, door], [stairs.id, stairs]]), projectId: 'geometry-test', revision: '0:2:3',
      partitionThickness: 0.12, selection: { floorId: lower.id, roomSignature: null, modelIds: [], roofId: null, wallIds: [] } }) }
}

type Program = AsyncGenerator<ToolCall, Pick<AgentTurn, 'message'>, ToolResult | undefined>
type Call = <N extends ToolName>(name: N, args: ToolArguments<N>) => ToolCall
function script(program: (call: Call) => Program): AgentProvider {
  return { start() {
    let n = 0
    const sequence = program((name, args) => ({ name, args: JSON.stringify(args), id: `test-${++n}` }))
    return { async next(outputs) {
      const step = await sequence.next(outputs[0]?.result)
      return step.done ? { calls: [], ...step.value } : { calls: [step.value] }
    } }
  } }
}

const get = <T>(result: ToolResult | undefined): T => {
  assert.ok(result?.ok, result?.ok === false ? result.message : 'missing tool result')
  return result.value as T
}
type RoomInfo = { id: string; outline: Point[]; function: string | null; area: number }
type DraftInfo = { draftId: string; walls: Array<{ id: string; start: Point; end: Point }>; rooms: RoomInfo[] }
const name = (draftId: string, title: string) => ({ draftId, title, explanation: 'The landing gives independent access to every proposed room.', advantages: ['All doors open from the landing.'], compromises: ['The bathroom and bedrooms share a fixed enclosure.'] })

async function run(input: AgentRequest, model: AgentProvider, limits = defaultAgentLimits, signal = new AbortController().signal) {
  const events: AgentEvent[] = []
  await runDesignAgent(input, model, signal, event => events.push(event), limits)
  const last = events.at(-1)
  return { last, events }
}

test('the existing-floor tools publish a native Springfield redesign with two private en suites', async () => {
  const { floors, modelDefinitions } = JSON.parse(readFileSync(new URL('../springfield_14.json', import.meta.url), 'utf8')) as {
    floors: FloorLevel[]; modelDefinitions: ModelDefinition[];
  }
  const floor = floors[1]
  const request: AgentRequest = { mode: 'live', prompt: 'Could you redesign the top floor with three bedrooms, two en suites and a shared bathroom?',
    history: [], previous: null, source: makeSceneSource({ floors, models: new Map([door, window, ...modelDefinitions].map(model => [model.id, model])),
      projectId: 'springfield-test', revision: 'one', partitionThickness: 0.15,
      selection: { floorId: floor.id, roomSignature: null, modelIds: [], roofId: null, wallIds: [] } }) }
  const unchanged = structuredClone(request.source)
  const roomDesign = script(async function* (call) {
    const layout = get<{ rooms: RoomInfo[]; walls: DraftInfo['walls']; connections: ReturnType<typeof openingConnections> }>(
      yield call('get_floor_layout', { floorId: floor.id, draftId: null }))
    const room = (area: number) => layout.rooms.find(item => Math.abs(item.area - area) < 0.05)!.id
    const [bedA, bedB, bedC, suiteA, suiteB, landing, sharedBathroom] = [17.11, 20.39, 13.49, 4.43, 7.87, 13.88, 8.11].map(room)
    const formerEntrance = layout.connections.find(link => [link.from, link.to].includes(suiteB) && [link.from, link.to].includes(landing))!
    const started = get<{ draftId: string; walls?: unknown }>(yield call('begin_room_redesign', { floorId: floor.id, baseId: null, bedrooms: 3, ensuites: 2 }))
    assert.equal(started.walls, undefined)
    const { draftId } = started
    const schedule = { draftId, landingId: landing, bedroomIds: [bedA, bedB, bedC], sharedBathroomId: sharedBathroom,
      ensuites: [{ bedroomId: bedA, bathroomId: suiteA }, { bedroomId: bedB, bathroomId: suiteB }] }
    get(yield call('set_room_schedule', schedule))
    const failed = get<{ valid: boolean; findings: string[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(failed.valid, false)
    assert.ok(failed.findings.some(finding => finding.includes('must open only into its bedroom')))
    const closed = get<{ walls: DraftInfo['walls']; rooms: RoomInfo[]; removedConnectionIds: string[] }>(
      yield call('remove_opening', { draftId, openingId: formerEntrance.openingId }))
    assert.equal(closed.walls.length, 1)
    assert.equal(closed.walls[0].id, formerEntrance.wallId)
    assert.equal(closed.rooms.length, 0)
    assert.deepEqual(closed.removedConnectionIds, [formerEntrance.openingId])
    const wallAtSuite = layout.walls.find(wall => projection(point(13.3, 5.923792), wall.start, wall.end).gap < 0.001)!
    get(yield call('insert_internal_door', { draftId, doors: [
      { wallId: wallAtSuite.id, roomId: suiteB, offset: projection(point(13.3, 5.923792), wallAtSuite.start, wallAtSuite.end).offset },
    ] }))
    const checked = get<{ valid: boolean; findings: string[]; walls?: unknown; rooms: RoomInfo[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(checked.valid, true, JSON.stringify(checked.findings))
    assert.equal(checked.walls, undefined)
    assert.ok(checked.rooms.every(room => typeof room.area === 'number' && !room.outline))
    const inspectedDraft = get<{ walls: DraftInfo['walls']; connections: ReturnType<typeof openingConnections> }>(
      yield call('get_floor_layout', { floorId: floor.id, draftId }))
    assert.equal(inspectedDraft.walls.length, floor.walls.length)
    assert.ok(inspectedDraft.connections.some(link => [link.from, link.to].includes(suiteB) && [link.from, link.to].includes(bedB)))
    get(yield call('publish_design', name(draftId, 'Three bedrooms and two private en suites')))
    return { message: 'The preview adds the second private entrance and closes its former landing doorway.' }
  })
  const parsed = parseAgentRequest(request)
  assert.ok(parsed)
  const { last } = await run(parsed, roomDesign)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing agent result')
  const [proposal] = last.result.proposals
  assert.ok(proposal, last.result.message)
  assert.equal(proposal.method, 'room-redesign')
  assert.equal(proposal.redesign?.ensuites.length, 2)
  assert.equal(proposal.rooms.length, 7)
  const sceneFloor = captureArchitecturalScene(request.source).floors[1]
  const edits = validateProposal(request.source, sceneFloor, proposal)
  assert.ok(edits)
  assert.equal(edits.walls.length, 2)
  assert.equal(edits.models.length, 1)
  assert.equal(edits.removedModelIds?.length, 1)
  assert.equal(edits.removedWallIds?.length, 0)
  assert.equal(edits.rooms.filter(room => room.function === 'bathroom').length, 3)
  assert.equal(validateProposal({ ...request.source, revision: 'two' }, sceneFloor, proposal), null)
  assert.deepEqual(request.source, unchanged)
  const followup = parseAgentRequest({ ...request, previous: proposal })
  assert.ok(followup)
  const revision = await run(followup, script(async function* (call) {
    const { draftId } = get<DraftInfo>(yield call('begin_room_redesign', { floorId: floor.id, baseId: proposal.id, bedrooms: null, ensuites: 0 }))
    get(yield call('set_room_name', { draftId, rooms: [{ roomId: proposal.redesign!.bedroomIds[0], name: 'Main bedroom' }] }))
    const checked = get<{ valid: boolean }>(yield call('evaluate_layout', { draftId }))
    assert.equal(checked.valid, true)
    get(yield call('publish_design', name(draftId, 'Main bedroom with en suite')))
    return { message: 'I changed the bedroom label.' }
  }))
  if (revision.last?.type !== 'result') throw new Error(revision.last?.type === 'error' ? revision.last.text : 'missing follow-up')
  assert.ok(revision.last.result.proposals[0].rooms.some(room => room.name === 'Main bedroom'))
})

test('the Springfield 14 room brief produces a validated preview before making an API call', async () => {
  const { floors, modelDefinitions } = JSON.parse(readFileSync(new URL('../springfield_14.json', import.meta.url), 'utf8')) as {
    floors: FloorLevel[]; modelDefinitions: ModelDefinition[];
  }
  const request: AgentRequest = { mode: 'live', prompt: 'could you see what it would look like with 3 bedrooms upstairs. 2 with en-suite. bathrooms/en-suites can have a window if they are on the left side',
    history: [], previous: null, source: makeSceneSource({ floors, models: new Map([door, window, ...modelDefinitions].map(model => [model.id, model])),
      projectId: 'springfield-reuse-test', revision: 'one', partitionThickness: 0.15,
      selection: { floorId: floors[0].id, roomSignature: null, modelIds: [], roofId: null, wallIds: [] } }) }
  let started = false
  const { last } = await run(request, { start() { started = true; throw new Error('The local preview should not spend API tokens.') } })
  assert.equal(started, false, last?.type === 'error' ? last.text : '')
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing local preview')
  const [preview] = last.result.proposals
  assert.ok(preview)
  assert.equal(preview.floorId, floors[1].id)
  assert.equal(preview.redesign?.bedroomIds.length, 3)
  assert.equal(preview.redesign?.ensuites.length, 2)
  assert.equal(preview.metrics.daylitBedrooms, 3)
  assert.equal(last.result.report.inputTokens + last.result.report.outputTokens, 0)
  assert.deepEqual(last.result.report.trace.map(entry => entry.tool), ['reuse_existing_rooms'])
  assert.deepEqual(preview.operations.filter(operation => operation.type !== 'label-room').map(operation => operation.type).sort(),
    ['create-doorway', 'remove-opening'])
  assert.ok(validateProposal(request.source, captureArchitecturalScene(request.source).floors[1], preview))
  assert.ok(parseAgentRequest({ ...request, previous: preview }))

  const retry = await run({ ...request, prompt: `“${request.prompt.replaceAll('en-suite', 'en‑suite')}”`,
    history: [{ role: 'user', text: request.prompt }, { role: 'assistant', text: 'I reached the input token budget.' }] },
  { start() { throw new Error('Retrying the same brief should not spend API tokens.') } })
  if (retry.last?.type !== 'result') throw new Error(retry.last?.type === 'error' ? retry.last.text : 'missing retry preview')
  assert.equal(retry.last.result.proposals[0].redesign?.ensuites.length, 2)
  assert.equal(retry.last.result.report.inputTokens + retry.last.result.report.outputTokens, 0)
})

test('a general floor draft can move and remove internal partitions and add a native window without a stair or bedroom schedule', async () => {
  const base = fixture()
  const upper = base.source.floors[1]
  const movable: Wall = { ...wall(5, 0, 5, 10), id: 'existing-divider', kind: 'internal', thickness: 0.12, height: upper.roomHeight }
  const removable: Wall = { ...wall(2, 4, 2, 6), id: 'extra-divider', kind: 'internal', thickness: 0.12, height: upper.roomHeight }
  const existing = { id: 'left-window', modelId: window.id, center: 5, width: 1.2, height: 1, bottom: 0.9 }
  const outerWalls = upper.walls.map((wall, index) => index === 3 ? { ...wall, openings: [existing] } : wall)
  const request: AgentRequest = { ...base, mode: 'live', prompt: 'Move the divider, remove the stub partition and add a window. No windows along the left side.',
    source: { ...base.source, floors: [{ ...upper, elevation: 0, walls: [...outerWalls, movable, removable] }],
      models: [...base.source.models, window], selection: { ...base.source.selection, floorId: upper.id } } }
  const { last } = await run(request, script(async function* (call) {
    const { draftId, excludedOpeningIds } = get<{ draftId: string; excludedOpeningIds: string[] }>(
      yield call('begin_room_redesign', { floorId: upper.id, baseId: null, bedrooms: null, ensuites: 0 }))
    assert.deepEqual(excludedOpeningIds, [existing.id])
    const invalid = yield call('remove_internal_partition', { draftId, wallId: upper.walls[0].id })
    assert.equal(invalid?.ok, false)
    get(yield call('move_partition_wall', { draftId, wallId: movable.id, ...wall(6, 0, 6, 10) }))
    get(yield call('remove_internal_partition', { draftId, wallId: removable.id }))
    const failed = get<{ valid: boolean; excludedOpeningIds: string[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(failed.valid, false)
    assert.deepEqual(failed.excludedOpeningIds, [existing.id])
    get(yield call('remove_opening', { draftId, openingId: existing.id }))
    const allowedWindow = { wallId: upper.walls[0].id, offset: 8, width: 1.4, height: 1.2, sillHeight: 0.95 }
    const rejected = yield call('insert_windows', { draftId, windows: [allowedWindow, { ...allowedWindow, wallId: upper.walls[3].id }] })
    assert.equal(rejected?.ok, false)
    get(yield call('insert_windows', { draftId, windows: [allowedWindow] }))
    const checked = get<{ valid: boolean; findings: string[]; rooms: Array<{ windowIds: string[] }> }>(yield call('evaluate_layout', { draftId }))
    assert.equal(checked.valid, true, JSON.stringify(checked.findings))
    assert.ok(checked.rooms.some(room => room.windowIds.some(id => id.startsWith('agent-'))))
    get(yield call('publish_design', name(draftId, 'Divider and window')))
    return { message: 'I moved the divider, removed the stub and added the window.' }
  }))
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing general edits')
  const [proposal] = last.result.proposals
  assert.ok(proposal, last.result.message)
  assert.ok(parseAgentRequest({ ...request, previous: proposal }))
  const edits = validateProposal(request.source, captureArchitecturalScene(request.source).floors[0], proposal)
  assert.ok(edits)
  assert.equal(edits.models.length, 1)
  assert.equal(edits.walls.find(wall => wall.id === upper.walls[3].id)?.openings, undefined)
  assert.deepEqual(edits.removedWallIds, [removable.id])
  assert.deepEqual(edits.walls.find(wall => wall.id === movable.id)?.start, point(6, 0))
  assert.equal(edits.walls.find(wall => wall.id === upper.walls[0].id)?.openings?.find(opening => opening.id === edits.models[0].id)?.bottom, 0.95)
})

test('the redesign tools build two new ensuite rooms and doors in an unfinished floor', async () => {
  const request = fixture()
  const floorId = request.source.floors[1].id
  const { last } = await run(request, script(async function* (call) {
    const { draftId } = get<DraftInfo>(yield call('begin_room_redesign', { floorId, baseId: null, bedrooms: 3, ensuites: 2 }))
    const geometry = get<DraftInfo>(yield call('create_partition_wall', { draftId, walls: [
      wall(0, 3.4, 12, 3.4), wall(0, 6.6, 12, 6.6), wall(5, 0, 5, 3.4), wall(6.5, 6.6, 6.5, 10),
      wall(10.2, 0, 10.2, 3.4), wall(1.8, 6.6, 1.8, 10),
    ] }))
    const at = (x: number, y: number) => geometry.rooms.find(room => pointInPolygon(point(x, y), room.outline))!.id
    const [bath, first, second, third, landing, upperSuite, lowerSuite] = [
      at(2, 1), at(8, 1), at(3.5, 8), at(9, 8), at(9, 5), at(11, 1), at(1, 8),
    ]
    const wallAt = (start: Point, end: Point) => geometry.walls.find(wall =>
      wall.start.x === start.x && wall.start.y === start.y && wall.end.x === end.x && wall.end.y === end.y)!.id
    const north = wallAt(point(0, 3.4), point(12, 3.4))
    const south = wallAt(point(0, 6.6), point(12, 6.6))
    get(yield call('insert_internal_door', { draftId, doors: [
      { wallId: north, roomId: bath, offset: 2.3 }, { wallId: north, roomId: first, offset: 8.4 },
      { wallId: south, roomId: second, offset: 3 }, { wallId: south, roomId: third, offset: 9.3 },
      { wallId: wallAt(point(10.2, 0), point(10.2, 3.4)), roomId: upperSuite, offset: 1.7 },
      { wallId: wallAt(point(1.8, 6.6), point(1.8, 10)), roomId: lowerSuite, offset: 1.7 },
    ] }))
    get(yield call('set_room_schedule', { draftId, landingId: landing, bedroomIds: [first, second, third], sharedBathroomId: bath,
      ensuites: [{ bedroomId: first, bathroomId: upperSuite }, { bedroomId: second, bathroomId: lowerSuite }] }))
    const evaluated = get<{ valid: boolean; findings: string[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(evaluated.valid, true, JSON.stringify(evaluated.findings))
    get(yield call('publish_design', name(draftId, 'New bedroom layout with two en suites')))
    return { message: 'This draft carves out two en suites.' }
  }))
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing redesign')
  const [proposal] = last.result.proposals
  assert.ok(proposal, last.result.message)
  const edits = validateProposal(request.source, captureArchitecturalScene(request.source).floors[1], proposal)
  assert.equal(edits?.walls.length, 6)
  assert.equal(edits?.models.length, 6)
})

test('the Springfield extension brief publishes with batched windows and a window-free left facade', async () => {
  const { floors, modelDefinitions } = JSON.parse(readFileSync(new URL('../springfield_new_extension.json', import.meta.url), 'utf8')) as {
    floors: FloorLevel[]; modelDefinitions: ModelDefinition[];
  }
  const floor = floors[1]
  const request: AgentRequest = {
    mode: 'live', prompt: 'Design the upstairs with three interesting bedrooms, a good-sized bathroom and an airy landing. No windows allowed on the left side of the building',
    history: [], previous: null, source: makeSceneSource({ floors, models: new Map([door, window, ...modelDefinitions].map(model => [model.id, model])),
      projectId: 'springfield-extension-test', revision: 'one', partitionThickness: 0.15,
      selection: { floorId: floors[0].id, roomSignature: null, modelIds: [], roofId: null, wallIds: [] } }),
  }
  let step = 0
  let floorId: string, draftId: string, originalWalls: DraftInfo['walls'], leftWallIds: string[]
  let bedroomIds: string[], landingId: string, sharedBathroomId: string
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const usage = { input_tokens: Math.ceil(Buffer.byteLength(String(init?.body)) / 3), output_tokens: 200 }
    const call = <N extends ToolName>(name: N, args: ToolArguments<N>) => Response.json({
      status: 'completed', usage, output: [modelCall(name, args, `extension-${step}`)],
    })
    if (step === 0) {
      const context = JSON.parse(body.input[0].content).context
      assert.equal(context.windowExclusion, 'left')
      const operations = body.tools[0].parameters.properties.operation.enum
      assert.equal(body.tools.length, 1)
      assert.ok(operations.includes('insert_windows'))
      assert.ok(!operations.includes('begin_design'))
      floorId = context.levels[1].id
      assert.match(floorId, /^~\d+$/)
      step++
      return call('get_floor_layout', { floorId, draftId: null })
    }
    const result = JSON.parse(body.input.at(-1).output) as ToolResult
    switch (step++) {
      case 1: {
        const layout = get<DraftInfo & { excludedWindowWallIds: string[] }>(result)
        originalWalls = layout.walls
        leftWallIds = layout.excludedWindowWallIds
        assert.equal(leftWallIds.length, 2)
        assert.ok(originalWalls.every(wall => /^~\d+$/.test(wall.id)))
        return call('begin_room_redesign', { floorId, baseId: null, bedrooms: 3, ensuites: 0 })
      }
      case 2:
        ({ draftId } = get<DraftInfo>(result))
        assert.match(draftId, /^~\d+$/)
        return call('create_partition_wall', { draftId, walls: [
          wall(-1.55, 0.404, 5.193, 0.404), wall(-1.55, 2.35, 5.193, 2.35),
          wall(1.8, -3.589, 1.8, 0.404), wall(2.55, 2.35, 2.55, 6.383),
        ] })
      case 3: {
        const draft = get<Omit<DraftInfo, 'rooms'> & { rooms: { id: string; outline: [number, number][] }[] }>(result)
        const roomAt = (x: number, y: number) => draft.rooms.find(room =>
          pointInPolygon(point(x, y), room.outline.map(([x, y]) => point(x, y))))!.id
        bedroomIds = [roomAt(0, -1), roomAt(4, -1), roomAt(4, 4)]
        landingId = roomAt(2, 1.4)
        sharedBathroomId = roomAt(0, 4)
        return call('insert_internal_door', { draftId, doors: [
          { wallId: draft.walls[0].id, roomId: bedroomIds[0], offset: 1.65 },
          { wallId: draft.walls[0].id, roomId: bedroomIds[1], offset: 5 },
          { wallId: draft.walls[1].id, roomId: sharedBathroomId, offset: 1.85 },
          { wallId: draft.walls[1].id, roomId: bedroomIds[2], offset: 5.3 },
        ] })
      }
      case 4: {
        get(result)
        const onFacade = (x: number, y: number) => {
          const host = originalWalls.find(item => projection(point(x, y), item.start, item.end).gap < 0.001)!
          assert.ok(!leftWallIds.includes(host.id))
          return { wallId: host.id, offset: projection(point(x, y), host.start, host.end).offset, width: 1.15, height: 1.1, sillHeight: 0.9 }
        }
        return call('insert_windows', { draftId, windows: [onFacade(0, -3.589), onFacade(3.65, -3.589), onFacade(3.9, 6.383), onFacade(5.193, 1.4)] })
      }
      case 5:
        get(result)
        return call('set_room_schedule', { draftId, landingId, bedroomIds, sharedBathroomId, ensuites: [] })
      case 6:
        get(result)
        return call('publish_design', name(draftId, 'Three bedrooms and an airy landing'))
      default:
        get(result)
        return Response.json({ status: 'completed', usage, output: [{ type: 'message', content: [
          { type: 'output_text', text: JSON.stringify({ message: 'Three bedrooms and the landing get daylight from permitted facades.', selection: null }) },
        ] }] })
    }
  })
  const { last } = await run(request, provider)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing Springfield redesign')
  const [proposal] = last.result.proposals
  assert.ok(proposal, last.result.message)
  assert.equal(proposal.windowExclusion, 'left')
  assert.equal(proposal.metrics.daylitBedrooms, 3)
  assert.equal(proposal.metrics.landingDaylight, true)
  assert.ok(proposal.warnings.some(warning => warning.includes('no modeled stair arrival')))
  assert.equal(last.result.report.trace.filter(entry => entry.tool === 'insert_windows').length, 1)
  assert.ok(last.result.report.inputTokens < defaultAgentLimits.inputTokens)
  assert.equal(last.result.report.trace[0].arguments && (last.result.report.trace[0].arguments as { floorId: string }).floorId, floor.id)
  const edits = validateProposal(request.source, captureArchitecturalScene(request.source).floors[1], proposal)
  assert.ok(edits)
  assert.equal(edits.models.length, 8)
  assert.equal(validateProposal(request.source, captureArchitecturalScene(request.source).floors[1], { ...proposal, windowExclusion: 'right' }), null)
  assert.ok(parseAgentRequest({ ...request, previous: proposal }))

  const installed = materializeFloorEdits(floor, edits)
  assert.equal(installed.assistantWindowExclusion, 'left')
  const revisionRequest = parseAgentRequest({ ...request, prompt: 'could we try with 4 befrooms?', source: {
    ...request.source, revision: 'applied', floors: [request.source.floors[0], installed],
    selection: { ...request.source.selection, floorId: installed.id },
  } })
  assert.ok(revisionRequest)
  const revisionProvider = script(async function* (call) {
    const layout = get<DraftInfo & { connections: ReturnType<typeof openingConnections>; excludedWindowWallIds: string[] }>(
      yield call('get_floor_layout', { floorId: installed.id, draftId: null }))
    assert.equal(layout.excludedWindowWallIds.length, 2)
    const { draftId } = get<DraftInfo>(yield call('begin_room_redesign', { floorId: installed.id, baseId: null, bedrooms: 4, ensuites: 0 }))
    const north = layout.walls.find(item => projection(point(1, 0.404), item.start, item.end).gap < 0.001)!
    const south = layout.walls.find(item => projection(point(1, 2.35), item.start, item.end).gap < 0.001)!
    const northDivider = layout.walls.find(item => projection(point(1.8, -1), item.start, item.end).gap < 0.001)!
    const doorAt = (x: number, y: number) => layout.connections.find(link => Math.hypot(link.position.x - x, link.position.y - y) < 0.03)!.openingId
    const batch = { draftId, removeOpeningIds: [doorAt(0.1, 0.404), doorAt(0.3, 2.35)], removeWallIds: [],
      moves: [{ wallId: northDivider.id, ...wall(2.2, -3.589, 2.2, 0.404) }], walls: [wall(0.75, 0.404, 0.75, 2.35)] }
    const rejected = yield call('edit_floor_partitions', { ...batch, removeWallIds: [installed.walls[0].id] })
    assert.equal(rejected?.ok, false)
    const changed = get<DraftInfo>(yield call('edit_floor_partitions', batch))
    const roomAt = (x: number, y: number) => (changed.rooms.find(room => pointInPolygon(point(x, y), room.outline)) ??
      layout.rooms.find(room => pointInPolygon(point(x, y), room.outline)))!.id
    const bedrooms = [roomAt(0, -1), roomAt(4, -1), roomAt(0, 4), roomAt(4, 4)]
    const bathroom = roomAt(0, 1.4), landing = roomAt(2, 1.4)
    const bathroomWall = changed.walls.find(item => projection(point(0.75, 1.4), item.start, item.end).gap < 0.001)!
    get(yield call('insert_internal_door', { draftId, doors: [
      { wallId: north.id, roomId: bedrooms[0], offset: 3.04 },
      { wallId: south.id, roomId: bedrooms[2], offset: 3.12 },
      { wallId: bathroomWall.id, roomId: bathroom, offset: 0.98 },
    ] }))
    const facade = installed.walls.find(item => projection(point(0.1, 6.383), item.start, item.end).gap < 0.001)!
    get(yield call('insert_windows', { draftId, windows: [
      { wallId: facade.id, offset: projection(point(0.1, 6.383), facade.start, facade.end).offset, width: 1.15, height: 1.1, sillHeight: 0.9 },
    ] }))
    get(yield call('set_room_schedule', { draftId, landingId: landing, bedroomIds: bedrooms, sharedBathroomId: bathroom, ensuites: [] }))
    get(yield call('publish_design', name(draftId, 'Four bedrooms off the gallery')))
    return { message: 'The fourth bedroom retains direct landing access and the left facade stays window-free.' }
  })
  const revision = await run(revisionRequest, { start(input) {
    assert.equal(input.context.revisingAppliedLayout, true)
    assert.equal(input.context.windowExclusion, 'left')
    assert.equal(input.context.levels[1].bedroomCount, 3)
    const session = revisionProvider.start(input)
    return { async next(outputs, signal, remainingOutputTokens) {
      const turn = await session.next(outputs, signal, remainingOutputTokens)
      return { ...turn, inputTokens: 8_000, outputTokens: 200 }
    } }
  } })
  if (revision.last?.type !== 'result') throw new Error(revision.last?.type === 'error' ? revision.last.text : 'missing four-bedroom redesign')
  const [updated] = revision.last.result.proposals
  assert.ok(updated, revision.last.result.message)
  assert.equal(updated.requirements.bedrooms, 4)
  assert.equal(updated.metrics.daylitBedrooms, 4)
  assert.equal(updated.windowExclusion, 'left')
  assert.equal(updated.operations.filter(operation => operation.type === 'remove-opening').length, 2)
  assert.equal(revision.last.result.report.inputTokens, 72_000)
  assert.ok(validateProposal(revisionRequest.source, captureArchitecturalScene(revisionRequest.source).floors[1], updated))
})

test('direct tools create a native upstairs proposal, reject a bad door and correct it', async () => {
  const request = fixture(), unchanged = structuredClone(request.source)
  const direct = script(async function* (call) {
    const overview = get<{ levels: Array<{ id: string; elevation: number }> }>(yield call('get_project_overview', {}))
    const floorId = overview.levels.find(level => level.elevation > 0)!.id
    yield call('get_floor_layout', { floorId, draftId: null })
    yield call('get_constraints', { floorId })
    const { draftId } = get<DraftInfo>(yield call('begin_design', { floorId, baseId: null, requirements, priority: 'landing' }))
    const geometry = get<DraftInfo>(yield call('create_partition_wall', { draftId, walls: [wall(0, 3.4, 12, 3.4), wall(0, 6.6, 12, 6.6), wall(5, 0, 5, 3.4), wall(6.5, 6.6, 6.5, 10)] }))
    const at = (x: number, y: number) => geometry.rooms.find(room => pointInPolygon(point(x, y), room.outline))!.id
    const [bath, first, second, third, landing] = [at(2, 1), at(9, 1), at(2, 8), at(9, 8), at(9, 5)]
    yield call('set_room_function', { draftId, rooms: [{ roomId: bath, function: 'bathroom' },
      ...[first, second, third].map(roomId => ({ roomId, function: 'bedroom' as const })), { roomId: landing, function: 'landing' }] })
    yield call('set_room_name', { draftId, rooms: [{ roomId: first, name: 'Main bedroom' }] })
    const invalid = yield call('insert_internal_door', { draftId, doors: [{ wallId: geometry.walls[0].id, roomId: bath, offset: 0.15 }] })
    assert.equal(invalid?.ok === false && invalid.code, 'door_clearance')
    const doorless = get<{ valid: boolean; findings: Array<{ code: string }> }>(yield call('evaluate_layout', { draftId }))
    assert.equal(doorless.valid, false)
    assert.ok(doorless.findings.some(finding => finding.code === 'room_entrance'))
    yield call('insert_internal_door', { draftId, doors: [
      { wallId: geometry.walls[0].id, roomId: bath, offset: 2.3 }, { wallId: geometry.walls[0].id, roomId: first, offset: 8.4 },
      { wallId: geometry.walls[1].id, roomId: second, offset: 2.2 }, { wallId: geometry.walls[1].id, roomId: third, offset: 9.3 },
    ] })
    const checked = get<{ valid: boolean; findings: unknown[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(checked.valid, true, JSON.stringify(checked.findings))
    get(yield call('publish_design', name(draftId, 'Central landing')))
    const copy = get<DraftInfo>(yield call('begin_design', { floorId, baseId: draftId, requirements, priority: 'bedrooms' }))
    yield call('move_partition_wall', { draftId: copy.draftId, wallId: geometry.walls[0].id, ...wall(0, 3.0, 12, 3.0) })
    const alternate = get<{ valid: boolean; findings: unknown[] }>(yield call('evaluate_layout', { draftId: copy.draftId }))
    assert.equal(alternate.valid, true, JSON.stringify(alternate.findings))
    get(yield call('publish_design', name(copy.draftId, 'Wider circulation')))
    return { message: 'Two layouts checked using the native floor and clearance tools.' }
  })
  const { last } = await run(request, direct)
  assert.equal(last?.type, 'result', last?.type === 'error' ? last.text : '')
  if (last.type !== 'result') throw new Error('missing final agent result')
  const [first, second] = last.result.proposals
  assert.equal(last.result.proposals.length, 2, last.result.message)
  assert.equal(first.method, 'agent')
  assert.ok(second.metrics.landingArea > first.metrics.landingArea + 2)
  assert.deepEqual(request.source, unchanged)
  const floor = captureArchitecturalScene(request.source).floors[1]
  const edits = validateAndMaterialize(request.source, floor, first)
  assert.ok(edits)
  assert.equal(edits.models.length, 4)
  assert.equal(edits.walls.length, 4)
  assert.equal(validateAndMaterialize({ ...request.source, revision: 'newer' }, floor, first), null)
  assert.equal(last.result.report.trace.find(entry => entry.tool === 'request_layout_candidates'), undefined)
  console.log('Direct geometry trace:', last.result.report.trace.map(entry => `${entry.tool}${entry.result.ok ? '' : ` (${entry.result.code})`}`).join(' → '))

  const revision = script(async function* (call) {
    const { draftId, walls } = get<DraftInfo>(yield call('begin_design', { floorId: first.floorId, baseId: first.id, requirements, priority: first.priority }))
    get(yield call('move_partition_wall', { draftId, wallId: walls[2].id, ...wall(5.6, 0, 5.6, 3.4) }))
    const evaluated = get<{ valid: boolean; findings: unknown[] }>(yield call('evaluate_layout', { draftId }))
    assert.equal(evaluated.valid, true, JSON.stringify(evaluated.findings))
    get(yield call('publish_design', name(draftId, 'Larger bathroom')))
    return { message: 'Moved the bathroom partition and kept the surrounding rooms.' }
  })
  const updated = await run({ ...request, prompt: 'Could we make the bathroom a little bigger?', previous: first }, revision)
  assert.equal(updated.last?.type, 'result', updated.last?.type === 'error' ? updated.last.text : '')
  if (updated.last.type !== 'result') throw new Error('no revision result')
  const updatedProposal = updated.last.result.proposals[0]
  assert.ok(updatedProposal.metrics.bathroomArea > first.metrics.bathroomArea + 1)
  assert.deepEqual(updatedProposal.operations.filter(op => op.type === 'create-doorway'), first.operations.filter(op => op.type === 'create-doorway'))
  console.log('Revision trace:', updated.last.result.report.trace.map(entry => entry.tool).join(' → '))

  const wire = parseAgentRequest({ ...request, prompt: 'Make the bathroom bigger', previous: { ...first, mesh: 'private fixture data' } })
  assert.ok(wire?.previous)
  assert.equal(Object.hasOwn(wire.previous, 'mesh'), false)
  const demo = await run(wire, mockDesignAgent)
  assert.equal(demo.last?.type, 'result')
  if (demo.last.type !== 'result') throw new Error('no demo result')
  assert.ok(demo.last.result.proposals[0]?.metrics.bathroomArea > first.metrics.bathroomArea, demo.last.result.message)
  assert.ok(demo.last.result.report.trace.some(entry => entry.tool === 'move_partition_wall' && entry.result.ok))
})

test('the demo inspects native constraints and reports an insufficient enclosure', async () => {
  const { last } = await run(fixture(5.5, 4.5), mockDesignAgent)
  assert.equal(last?.type, 'result')
  if (last.type !== 'result') throw new Error('missing result')
  assert.deepEqual(last.result.proposals, [])
  assert.match(last.result.message, /fewer|2 bedrooms|usable floor space/)
  assert.ok(last.result.report.trace.some(step => step.tool === 'get_constraints'))
})

test('limits, cancellation and invalid model arguments never expose partial geometry', async () => {
  const request = fixture(), original = structuredClone(request.source)
  const base = script(async function* (call) {
    yield { id: 'malformed', name: 'create_partition_wall', args: '{"rawJavascript":"invalid"}' }
    yield call('get_project_overview', {})
    return { message: 'Done' }
  })
  const budget = await run(request, base, { ...defaultAgentLimits, toolCalls: 1 })
  assert.equal(budget.last?.type, 'result')
  if (budget.last.type !== 'result') throw new Error('missing result')
  assert.equal(budget.last.result.report.trace[0].arguments, null)
  assert.equal(budget.last.result.report.stop, 'tool-call budget')
  assert.equal(budget.last.result.proposals.length, 0)

  const slow: AgentProvider = { start: () => ({ next: (_results, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) }) }
  const keepAlive = setTimeout(() => undefined, 30)
  try {
    const timed = await run(request, slow, { ...defaultAgentLimits, milliseconds: 10 })
    assert.equal(timed.last?.type, 'error')
    if (timed.last.type !== 'error') throw new Error('missing timeout')
    assert.equal(timed.last.report?.stop, 'timeout')
  } finally { clearTimeout(keepAlive) }
  const abort = new AbortController(); abort.abort()
  assert.deepEqual((await run(request, base, defaultAgentLimits, abort.signal)).events, [])
  assert.deepEqual(request.source, original)
  assert.ok(parseAgentRequest(request))
  assert.equal(parseAgentRequest({ ...request, source: { ...request.source, partitionThickness: 15 } }), null)
})

test('a timeout while waiting for the model returns the layout that already passed validation', async t => {
  const deadline = new AbortController()
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal)
  const request = { ...fixture(), mode: 'live' as const }
  request.source.models.push(window)
  const provider = script(async function* (call) {
    const { draftId } = get<{ draftId: string }>(yield call('begin_room_redesign',
      { floorId: 'ground', baseId: null, bedrooms: null, ensuites: 0 }))
    get(yield call('insert_windows', { draftId, windows: [{ wallId: 'outer-0', offset: 2, width: 1.2, height: 1.1, sillHeight: 0.9 }] }))
    get(yield call('publish_design', name(draftId, 'Ground floor window')))
    deadline.abort(new DOMException('Timed out waiting for the model', 'TimeoutError'))
    return { message: 'Late summary' }
  })
  const { last } = await run(request, provider)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing result')
  assert.equal(last.result.report.stop, 'timeout')
  assert.equal(last.result.proposals.length, 1)
  assert.ok(last.result.proposals[0].operations.some(operation => operation.type === 'create-window'))
})

test('an OpenAI turn that never finishes its response body ends with a retryable provider timeout', async () => {
  let calls = 0
  let inFlight: AbortSignal | null | undefined
  const model = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    calls++
    inFlight = init?.signal
    return new Response(new ReadableStream())
  })
  const keepAlive = setTimeout(() => undefined, 150)
  try {
    const { last } = await run({ ...fixture(), mode: 'live' }, model, { ...defaultAgentLimits, milliseconds: 1_000, modelTurnMilliseconds: 30 })
    assert.ok(last?.type === 'error')
    assert.equal(last.report?.stop, 'OpenAI turn timeout')
    assert.match(last.text, /OpenAI did not finish its reply/)
    assert.equal(last.retryable, true)
    assert.equal(inFlight?.aborted, true)
    assert.equal(calls, 1)
  } finally { clearTimeout(keepAlive) }
})

test('the workspace worker stays alive to send a terminal message when its provider has no active handles', async t => {
  const preload = 'globalThis.fetch = async () => new Response(new ReadableStream())'
  const worker = new Worker(new URL('../server/design-agent.worker.ts', import.meta.url), {
    execArgv: ['--experimental-strip-types', '--import', `data:text/javascript,${encodeURIComponent(preload)}`],
    workerData: { request: { ...fixture(), mode: 'live' }, credentials: { apiKey: 'mock', model: 'mock' },
      limits: { ...defaultAgentLimits, milliseconds: 1_000, modelTurnMilliseconds: 30 } },
  })
  t.after(() => worker.terminate())
  const messages: AgentEvent[] = []
  worker.on('message', event => messages.push(event))
  const status = await new Promise<number>((resolve, reject) => {
    worker.once('exit', resolve)
    worker.once('error', reject)
  })
  assert.equal(status, 0)
  const last = messages.at(-1)
  assert.ok(last?.type === 'error')
  assert.equal(last.report?.stop, 'OpenAI turn timeout')
  assert.equal(last.retryable, true)
})

test('an open-ended redesign arrives with a compact level brief for a follow-up question', async () => {
  const prompt = 'Can you help redesign the layout of this house?'
  const message = 'We could start on the ground floor. What would you most like to improve?'
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.match(body.instructions, /open-ended request.*ask one focused question/)
    assert.equal(body.input.length, 1)
    const brief = JSON.parse(body.input[0].content)
    assert.equal(brief.prompt, prompt)
    assert.equal(brief.context.selection.floorId, 'ground')
    assert.equal(brief.context.levels[1].roomCount, 1)
    assert.ok(brief.context.levels.every((level: Record<string, unknown>) => !Object.hasOwn(level, 'walls')))
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: JSON.stringify({ message, selection: null }) },
    ] }] })
  })
  const { last } = await run({ ...fixture(), mode: 'live', prompt }, provider)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing design question')
  assert.equal(last.result.message, message)
  assert.deepEqual(last.result.report.trace, [])
})

function modelCall<N extends ToolName>(operation: N, args: ToolArguments<N>, id: string) {
  return { type: 'function_call', name: 'house_design', call_id: id,
    arguments: JSON.stringify({ operation, argumentsJson: JSON.stringify(args) }) }
}

test('a whole-home brief on a four-wall shell publishes from one model operation, with native room labels and daylight', async () => {
  const base = fixture(12, 11)
  const floor = { ...base.source.floors[0], walls: base.source.floors[0].walls.map(wall => ({ ...wall, openings: [] })), models: [] }
  const request: AgentRequest = { ...base, mode: 'live', prompt: 'can you add 3 generous bedrooms, 2 with en-suite, an open plan kitchen/diner, utility room and a family bathroom. the hallway should be light and airy.',
    source: { ...base.source, floors: [floor], models: [...base.source.models, window] } }
  const program: ToolArguments<'compose_floor_layout'> = {
    floorId: floor.id,
    walls: [
      { start: [0, 8], end: [12, 8] },
      { start: [5.05, 0], end: [5.05, 8] }, { start: [6.95, 0], end: [6.95, 8] },
      { start: [0, 4.1], end: [5.05, 4.1] }, { start: [0, 6.2], end: [5.05, 6.2] },
      { start: [6.95, 4], end: [12, 4] }, { start: [9.65, 2], end: [9.65, 6] },
      { start: [9.65, 2], end: [12, 2] }, { start: [9.65, 6], end: [12, 6] },
    ],
    hallway: [6, 3], bedrooms: [[2, 2], [8, 2], [8, 6]],
    familyBathroom: [2, 5], ensuites: [{ bedroom: 2, bathroom: [11, 3] }, { bedroom: 3, bathroom: [11, 5] }],
    kitchenDiner: [6, 9.5], utility: [2, 7],
    daylight: { bedrooms: true, hallway: true, kitchenDiner: true },
    title: 'Three bedrooms around a bright hallway',
    explanation: 'A central hall serves all shared spaces and leads to the open-plan kitchen/diner.',
  }

  for (const needsCorrection of [false, true]) {
    let apiCalls = 0
    const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const attempt = ++apiCalls
      assert.ok(attempt <= (needsCorrection ? 2 : 1), 'A completed draft should not need another model round trip.')
      if (attempt === 1) {
        assert.ok(Buffer.byteLength(String(init?.body)) < 6000, 'Shell planning should send a compact request.')
        const shell = JSON.parse(body.input[0].content).context.openFloor
        assert.equal(shell.walls.length, 4)
        assert.equal(shell.floorId, floor.id)
        assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['get_floor_layout', 'compose_floor_layout'])
      } else {
        const feedback = JSON.parse(body.input.at(-1).output)
        assert.equal(feedback.code, 'layout_needs_revision')
        assert.match(feedback.message, /doorway.*shared/)
      }
      const args = needsCorrection && attempt === 1
        ? { ...program, ensuites: [{ bedroom: 1, bathroom: [11, 3] }, program.ensuites[1]] }
        : program
      return Response.json({ status: 'completed', output: [modelCall('compose_floor_layout', args, `shell-${attempt}`)] })
    })
    const { last } = await run(request, provider)
    if (last?.type !== 'result') throw new Error(last?.type === 'error' ? `${last.text} ${JSON.stringify(last.report)}` : 'missing shell preview')
    assert.equal(apiCalls, needsCorrection ? 2 : 1, JSON.stringify(last.result.report))
    const [preview] = last.result.proposals
    assert.ok(preview, JSON.stringify(last.result.report))
    assert.equal(preview.rooms.length, 9)
    assert.equal(preview.redesign?.ensuites.length, 2)
    assert.equal(preview.metrics.daylitBedrooms, 3)
    assert.ok(preview.metrics.smallestBedroom > 12)
    assert.ok(preview.metrics.landingDaylight)
    assert.ok(preview.rooms.some(room => room.function === 'kitchen-diner' && room.windowIds.length > 0))
    assert.ok(preview.rooms.some(room => room.function === 'utility'))
    assert.equal(preview.operations.filter(op => op.type === 'create-doorway').length, 8)
    assert.ok(validateProposal(request.source, captureArchitecturalScene(request.source).floors[0], preview))
    const revision = parseAgentRequest(JSON.parse(JSON.stringify({ ...request, previous: preview,
      prompt: "Could you change it so the hallway doesn't go from one side of the house to the other?",
      history: [{ role: 'user', text: request.prompt }, { role: 'assistant', text: last.result.message }],
    })))
    assert.ok(revision)
    assert.deepEqual(revision.previous?.redesign, preview.redesign)
    if (needsCorrection) continue

    const revisedProvider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const context = JSON.parse(body.input[0].content).context
      assert.equal(context.openFloor.floorId, preview.floorId)
      assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['get_floor_layout', 'compose_floor_layout'])
      assert.equal(context.activeProposal.partitions.length, preview.operations.filter(op => op.type === 'create-partition').length)
      assert.equal(context.activeProposal.rooms.length, preview.rooms.length)
      assert.ok(context.activeProposal.rooms.every((room: { at?: number[] }) => room.at?.length === 2))
      const revisedWalls = program.walls.map(({ start, end }) => ({
        start: [start[0], start[1] === 8 ? 7.8 : start[1]], end: [end[0], end[1] === 8 ? 7.8 : end[1]],
      }))
      return Response.json({ status: 'completed',
        output: [modelCall('compose_floor_layout', { ...program, walls: revisedWalls }, 'hallway-revision')] })
    })
    const revised = (await run(revision, revisedProvider)).last
    if (revised?.type !== 'result') throw new Error(revised?.type === 'error' ? revised.text : 'missing hallway revision')
    assert.deepEqual(revised.result.report.trace.map(entry => entry.tool), ['compose_floor_layout'])
    assert.ok(revised.result.proposals[0].metrics.landingArea < preview.metrics.landingArea)
    assert.equal(revised.result.proposals[0].rooms.length, preview.rooms.length)
    assert.equal(revised.result.proposals[0].redesign?.ensuites.length, preview.redesign?.ensuites.length)
  }

  const designRequest = { ...request, prompt: `${request.prompt} Add a front door, patio doors and utility access from the kitchen.`,
    source: { ...request.source, models: [...request.source.models, frontDoor, patioDoor] } }
  const design: NonNullable<ToolArguments<'compose_floor_layout'>['design']> = { utilityAccess: 'kitchen', windowFocus: [{ room: 'kitchenDiner', at: [0, 9.5] }],
    advantages: ['The utility opens from the kitchen, keeping service traffic off the hall.'],
    compromises: ['The front door occupies the hallway’s available exterior wall.'] }
  const designProvider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.match(body.instructions, /materially different arrangements/)
    assert.ok(Buffer.byteLength(String(init?.body)) < 6000)
    assert.deepEqual(JSON.parse(body.input[0].content).context.openFloor.doorWidths, { front: 0.97, patio: 2.4 })
    return Response.json({ status: 'completed', output: [modelCall('compose_floor_layout', {
      ...program, daylight: { ...program.daylight, hallway: false },
      exteriorDoors: [{ kind: 'front', at: [6, 0] }, { kind: 'patio', at: [6, 11] }],
      design,
    }, 'considered-layout')] })
  })
  const { last } = await run(designRequest, designProvider)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing designed preview')
  const [preview] = last.result.proposals
  assert.ok(preview, JSON.stringify(last.result.report.trace))
  assert.equal(preview.redesign?.home?.utilityAccess, 'kitchen')
  assert.deepEqual(preview.narrative?.advantages, design.advantages)
  assert.deepEqual(preview.narrative?.compromises, design.compromises)
  const edits = validateProposal(designRequest.source, captureArchitecturalScene(designRequest.source).floors[0], preview)
  assert.ok(edits)
  const installed = materializeFloorEdits(floor, edits)
  const exteriorDoors = preview.operations.filter(op => op.type === 'create-doorway' && !!op.exterior)
  assert.equal(exteriorDoors.length, 2)
  assert.ok(installed.models.some(model => model.modelId === frontDoor.id))
  assert.ok(installed.models.some(model => model.modelId === patioDoor.id))
  const openings = openingConnections(installed.walls, preview.rooms)
  const connects = (from: string | null | undefined, to: string | null | undefined) =>
    openings.some(link => link.from === from && link.to === to || link.from === to && link.to === from)
  assert.ok(connects(preview.redesign?.home?.utilityId, preview.redesign?.home?.kitchenDinerId))
  assert.ok(connects(preview.redesign?.landingId, null))
  assert.ok(connects(preview.redesign?.home?.kitchenDinerId, null))
  const kitchen = preview.rooms.find(room => room.id === preview.redesign?.home?.kitchenDinerId)
  assert.ok(preview.operations.some(op => op.type === 'create-window' && kitchen?.windowIds.includes(op.id) && op.wallId === 'outer-3'))
  const retained = parseAgentRequest(JSON.parse(JSON.stringify({ ...designRequest, previous: preview })))?.previous
  assert.ok(retained?.operations.some(op => op.type === 'create-doorway' && op.exterior === 'patio'))
  assert.equal(retained.redesign?.home?.utilityAccess, 'kitchen')
})

test('front and patio doors can be added directly to an existing floor draft', async () => {
  const base = fixture()
  const request = { ...base, mode: 'live' as const, prompt: 'Add a front entrance and a bifold patio door to the ground floor.',
    source: { ...base.source, models: [...base.source.models, frontDoor, patioDoor] } }
  const provider = script(async function* (call) {
    const { draftId } = get<{ draftId: string }>(yield call('begin_room_redesign',
      { floorId: 'ground', baseId: null, bedrooms: null, ensuites: 0 }))
    const corner = yield call('insert_exterior_doors', { draftId, doors: [{ wallId: 'outer-0', kind: 'patio', offset: 0.2 }] })
    assert.equal(corner?.ok, false)
    get(yield call('insert_exterior_doors', { draftId,
      doors: [{ wallId: 'outer-0', kind: 'front', offset: 3 }, { wallId: 'outer-2', kind: 'patio', offset: 4 }] }))
    get(yield call('publish_design', name(draftId, 'Front and patio access')))
    return { message: 'The two openings are ready to preview.' }
  })
  const { last } = await run(request, provider)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing exterior door preview')
  const [preview] = last.result.proposals
  assert.ok(preview)
  const geometry = captureArchitecturalScene(request.source).floors[0]
  const edits = validateProposal(request.source, geometry, preview)
  assert.ok(edits)
  assert.deepEqual(edits.models.map(model => model.modelId), [frontDoor.id, patioDoor.id])
})

test('the live agent finds and previews compatible bifold variants without rebuilding the doorway', async () => {
  const base = fixture()
  const [lower, upper] = base.source.floors
  const instanceId = '4a851bb5-963c-45f6-a5a2-aa886134f2ba'
  const placedDoor = { id: instanceId, modelId: patioDoor.id, position: point(6, 0), scale: 1, rotation: 0,
    mirrored: true, widthScale: 0.9, materialOverrides: { frame: 'custom-oak' },
    wallAttachment: { wallId: lower.walls[0].id, offset: 6, side: -1 as const } }
  const opening = { id: instanceId, modelId: placedDoor.modelId, center: 6, width: 2.16, bottom: 0, height: 2.08 }
  const installed = { ...lower, models: [...lower.models, placedDoor], walls: lower.walls.map((wall, index) =>
    index === 0 ? { ...wall, openings: [opening] } : wall) }
  const openDoor = { ...patioDoor, id: BIFOLD_DOOR_MODELS.open, name: 'Three-pane Bifold Doors (Open)', depth: 0.81,
    sourceUrl: '/assets/bifold-open.glb' }
  const source = makeSceneSource({ ...base.source, floors: [installed, upper], models: new Map([
    ...base.source.models.map(model => [model.id, model] as const), [patioDoor.id, patioDoor], [openDoor.id, openDoor],
  ]) })
  assert.ok(source.models.some(model => model.id === openDoor.id && model.sourceUrl === undefined))
  const request = parseAgentRequest({ ...base, mode: 'live', prompt: 'Could we change the closed bifold doors to open ones?', source })
  assert.ok(request)
  let turns = 0
  const transport = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['find_model_variants', 'propose_model_variants'])
    assert.equal(JSON.parse(body.input[0].content).context.openFloor, undefined)
    if (!turns++) return Response.json({ status: 'completed', output: [modelCall('find_model_variants', { query: 'bi-fold', floorId: null }, 'find-bifold')] })
    const lookup = JSON.parse(body.input.at(-1).output).value
    assert.equal(lookup.totalInstances, 1)
    assert.equal(lookup.instances[0].modelId, patioDoor.id)
    assert.match(lookup.instances[0].instanceId, /^~\d+$/)
    const target = lookup.candidates[0].variants.find((variant: { state: string }) => variant.state === 'open')
    return Response.json({ status: 'completed', output: [modelCall('propose_model_variants', { replacements: [
      { floorId: lookup.instances[0].floorId, instanceId: lookup.instances[0].instanceId, modelId: target.modelId },
    ] }, 'replace-bifold')] })
  })
  const { last } = await run(request, transport)
  assert.equal(turns, 2)
  assert.ok(last?.type === 'result')
  const [proposal] = last.result.proposals
  assert.equal(proposal.method, 'model-variants')
  const floor = captureArchitecturalScene(source).floors[0]
  const edits = validateProposal(source, floor, proposal)
  assert.ok(edits)
  const result = materializeProposalFloors([installed, upper], proposal.floorId, edits)
  assert.ok(result)
  assert.equal(result[1], upper)
  assert.deepEqual(result[0].models.at(-1), { ...placedDoor, modelId: openDoor.id })
  assert.deepEqual(result[0].walls[0].openings, [{ ...opening, modelId: openDoor.id }])
  assert.equal(installed.models.at(-1), placedDoor)
  assert.deepEqual(parseAgentRequest({ ...request, previous: proposal })?.previous?.operations, proposal.operations)
  const mismatched = { ...source, models: source.models.map(model => model.id === openDoor.id ? { ...model, width: 3, openingWidth: 3 } : model) }
  assert.equal(validateProposal(mismatched, floor, proposal), null)
})

test('a full home brief previews rooms, stair and both floors as one validated edit', async () => {
  const request = fixture(16, 14)
  request.mode = 'live'
  request.prompt = "Great. Could you now add the rooms? We'd like a nice big kitchen/diner on the north side, a downstairs office, cloakroom, utility room and front room. Stairs up to 4 bedrooms (one en-suite) and a family bathroom."
  request.source.models.push(window)
  const existing = request.source.floors[0].models[0]
  existing.id = 'agent-previous-stair'
  existing.position = point(2.5, 4)
  const original = structuredClone(request.source)
  const disconnected = script(async function* (call) {
    const result = yield call('propose_staircase', { floorId: 'ground', upperFloorId: 'upstairs', layout: 'auto', near: null, width: null })
    assert.ok(result && !result.ok && result.code === 'coordinated_scope')
    return { message: 'The stairs need both room plans.' }
  })
  const rejected = (await run(request, disconnected)).last
  assert.ok(rejected?.type === 'result' && !rejected.result.proposals.length)

  type Brief = ToolArguments<'compose_two_storey_layout'>
  const hallWalls = [{ start: [5, 0], end: [5, 14] }, { start: [9.5, 0], end: [9.5, 14] }]
  const room = (name: string, role: Brief['lower']['rooms'][number]['role'], at: number[], accessFrom: number | null = 1) =>
    ({ name, role, at, accessFrom, daylight: ['bedroom', 'office', 'living-room', 'kitchen-diner'].includes(role) })
  const brief: Brief = {
    lower: { floorId: 'ground', removeWallIds: [], closeOpeningIds: [],
      walls: [...hallWalls, { start: [0, 7], end: [5, 7] }, { start: [9.5, 7], end: [16, 7] },
        { start: [9.5, 10.5], end: [16, 10.5] }],
      rooms: [room('Entrance hall', 'hall', [7, 7], null), room('North kitchen and dining', 'kitchen-diner', [12, 3]),
        room('Front room', 'living-room', [3, 3]), room('Office', 'office', [3, 9]),
        room('Utility', 'utility', [12, 8]), room('Cloakroom', 'cloakroom', [12, 12])] },
    upper: { floorId: 'upstairs', removeWallIds: [], closeOpeningIds: ['window-1'],
      walls: [...hallWalls, { start: [0, 6], end: [5, 6] }, { start: [0, 2.6], end: [2.4, 2.6] }, { start: [2.4, 0], end: [2.4, 2.6] },
        { start: [9.5, 4.5], end: [16, 4.5] }, { start: [9.5, 9], end: [16, 9] }],
      rooms: [room('Landing', 'hall', [7, 7], null), room('Bedroom 1', 'bedroom', [3.4, 4]),
        room('En suite', 'ensuite', [1, 1], 2), room('Bedroom 2', 'bedroom', [3, 10]), room('Bedroom 3', 'bedroom', [12, 2]),
        room('Bedroom 4', 'bedroom', [12, 7]), room('Family bathroom', 'bathroom', [12, 11])] },
    stair: { layout: 'auto', near: null, replaceStairId: null },
    title: 'North-facing farmhouse layout', explanation: 'A full-height hall connects the north kitchen to the four bedrooms above.',
  }
  let calls = 0
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['inspect_two_storey_layout', 'compose_two_storey_layout'])
    if (++calls === 1) return Response.json({ status: 'completed', output: [modelCall('inspect_two_storey_layout', {
      floorId: 'ground', upperFloorId: 'upstairs',
    }, 'floors')] })
    if (calls === 2) return Response.json({ status: 'completed', output: [modelCall('compose_two_storey_layout', {
      ...brief, upper: { ...brief.upper, rooms: brief.upper.rooms.filter(room => room.name !== 'Bedroom 4') },
    }, 'incomplete')] })
    const feedback = JSON.parse(body.input.at(-1).output)
    assert.equal(feedback.code, 'room_schedule')
    assert.match(feedback.message, /4 upstairs bedrooms/)
    return Response.json({ status: 'completed', output: [modelCall('compose_two_storey_layout', brief, 'coordinated')] })
  })
  const { last } = await run(request, provider)
  assert.ok(last?.type === 'result', JSON.stringify(last))
  const [proposal] = last.result.proposals
  assert.ok(proposal, JSON.stringify(last.result.report.trace))
  assert.equal(proposal.method, 'coordinated')
  assert.equal(calls, 3)
  const saved = parseAgentRequest(JSON.parse(JSON.stringify({ ...request, previous: proposal })))?.previous
  assert.ok(saved)
  const scene = captureArchitecturalScene(request.source)
  const edits = validateProposal(request.source, scene.floors[0], saved)
  assert.ok(edits?.stair && edits.additionalFloors?.length === 1)
  assert.ok(edits.removedModelIds?.includes(existing.id))
  const floors = materializeProposalFloors(request.source.floors, 'ground', edits)
  assert.ok(floors)
  assert.ok(floors[0].rooms.some(room => room.name === 'North kitchen and dining'))
  assert.equal(floors[1].rooms.filter(room => room.function === 'bedroom').length, 4)
  assert.ok(edits.overlays?.upstairs.rooms.some(room => room.name === 'Family bathroom'))
  const actual = captureArchitecturalScene({ ...request.source, floors, models: [...request.source.models, edits.stair.definition] })
  const upperLanding = actual.floors[1].rooms.find(room => room.function === 'landing')!
  assert.equal(actual.floors[1].stairsFromBelow.length, 1)
  assert.ok(actual.floors[1].stairsFromBelow[0].openings.flat().every(point => pointInPolygon(point, upperLanding.polygon)))
  assert.deepEqual(request.source, original)

  const prompt = "this is my house. we can extend out the north side by 4m, out the east side by 2.5m. could you please design a wraparound two-storey extension so we have a kitchen/diner and open plan living. 4 bedrooms upstairs, one of them with an en-suite, family bathroom and any stairs you think would look good. we're going for farmhouse style"
  const expand = ([x, y]: number[]) => [x === 16 ? 18.5 : x, y === 0 ? -4 : y]
  const expandFloor = (floor: Brief['lower']) => ({
    ...floor, removeWallIds: ['outer-0', 'outer-1'],
    walls: floor.walls.map(({ start, end }) => ({ start: expand(start), end: expand(end) })),
  })
  const extended = { ...brief, lower: expandFloor(brief.lower), upper: expandFloor(brief.upper) }
  const inspection = script(async function* (call) {
    const outline = get<{ lower: { footprint: Point[][] }; upper: { footprint: Point[][] } }>(
      yield call('inspect_two_storey_layout', { floorId: 'ground', upperFloorId: 'upstairs' }))
    assert.ok(outline.lower.footprint.flat().some(point => point.y < -4))
    assert.ok(outline.upper.footprint.flat().some(point => point.x > 18.5))
    const attempted = yield call('compose_two_storey_layout', extended)
    get(attempted)
    return { message: 'The complete design is ready.' }
  })
  const complete = async (draftRequest: AgentRequest, model = inspection) => {
    const { last } = await run(draftRequest, model)
    assert.ok(last?.type === 'result', JSON.stringify(last))
    assert.equal(last.result.proposals.length, 1, JSON.stringify(last.result.report.trace))
    return last.result.proposals[0]
  }
  const fullRequest = { ...request, prompt }
  let extensionCalls = 0
  const extendedProvider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const context = JSON.parse(body.input[0].content)
    assert.equal(context.prompt, prompt)
    assert.equal(context.context.extensionStage, 'interior')
    assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['inspect_two_storey_layout', 'compose_two_storey_layout'])
    if (++extensionCalls === 1) return Response.json({ status: 'completed', output: [modelCall('inspect_two_storey_layout',
      { floorId: 'ground', upperFloorId: 'upstairs' }, 'expanded-levels')] })
    const outline = JSON.parse(body.input.at(-1).output).value
    assert.ok(outline.lower.footprint.flat().some((point: number[]) => point[1] < -4))
    assert.ok(outline.upper.footprint.flat().some((point: number[]) => point[0] > 18.5))
    return Response.json({ status: 'completed', output: [modelCall('compose_two_storey_layout', extended, 'whole-extension')] })
  })
  const whole = await complete(fullRequest, extendedProvider)
  assert.equal(extensionCalls, 2)
  assert.ok(whole.method === 'coordinated' && whole.extensionBasis)
  assert.deepEqual(request.source, original)
  const decoded = parseAgentRequest(JSON.parse(JSON.stringify({ ...fullRequest, previous: whole })))?.previous
  assert.ok(decoded?.extensionBasis)
  const combined = validateProposal(request.source, scene.floors[0], decoded)
  assert.ok(combined?.stair)
  const integrated = materializeProposalFloors(request.source.floors, 'ground', combined)
  assert.ok(integrated?.every(floor => floor.floorFootprints?.length && floor.rooms.some(room => room.function === 'landing')))
  assert.ok(integrated[0].walls.some(wall => wall.kind === 'external' && wall.start.y === -4))
  assert.ok(integrated[1].walls.some(wall => wall.kind === 'external' && wall.start.x === 18.5))
  assert.ok(integrated.every(floor => !floor.walls.some(wall => wall.id === 'outer-0' || wall.id === 'outer-1')))
  for (const model of integrated.flatMap(floor => floor.models)) {
    assert.ok(!model.wallAttachment || integrated.some(floor => floor.walls.some(wall => wall.id === model.wallAttachment?.wallId)))
  }
  const revision = await complete({ ...fullRequest, prompt: 'Could you refine the kitchen?', previous: decoded })
  assert.deepEqual(revision.extensionBasis, whole.extensionBasis)
  const appliedShell = stageExtension(request.source, whole.extensionBasis)
  assert.ok(appliedShell)
  const insideApplied = await complete({ ...fullRequest, source: { ...appliedShell, revision: 'shell-applied' } })
  assert.equal(insideApplied.extensionBasis, undefined)
  const relative = fullRequest.prompt.replace('north side by 4m, out the east side by 2.5m', 'back by 4m, out the right side by 2.5m')
  const phases: string[] = []
  const relativeModel: AgentProvider = { start(input) {
    phases.push(input.context.extensionStage ?? '')
    return (input.context.extensionStage === 'footprint' ? script(async function* (call) {
      yield call('propose_extension', { floorId: 'ground', upperFloorId: 'upstairs',
        spans: [{ wallId: 'outer-0', depth: 4 }, { wallId: 'outer-1', depth: 2.5 }] })
      return { message: 'Exterior stage only.' }
    }) : inspection).start(input)
  } }
  const interpreted = await complete({ ...fullRequest, prompt: relative }, relativeModel)
  assert.deepEqual(phases, ['footprint', 'interior'])
  assert.ok(interpreted.extensionBasis)
  const blocked = (await run(fullRequest, script(async function* (call) {
    yield call('compose_two_storey_layout', { ...extended, upper: { ...extended.upper, walls: [] } })
    return { message: 'The room markers need closed partitions.' }
  }))).last
  assert.ok(blocked?.type === 'result' && blocked.result.proposals.length === 0)
})

test('the live staircase tool selects a turning stair where a straight one does not fit', async () => {
  const base = fixture(4.2, 3.2)
  const request = { ...base, mode: 'live' as const, prompt: 'Add stairs from the ground floor to the first floor.',
    source: { ...base.source, floors: base.source.floors.map(floor => ({ ...floor, models: [] })) } }
  const args = { floorId: 'ground', upperFloorId: 'upstairs', near: null, layout: 'auto' as const, width: null }
  const noStraightStair = script(async function* (call) {
    const response = yield call('propose_staircase', { ...args, layout: 'straight' })
    assert.ok(response && !response.ok)
    assert.equal(response.code, 'stair_fit')
    return { message: 'A straight stair does not fit.' }
  })
  const rejected = (await run(request, noStraightStair)).last
  assert.ok(rejected?.type === 'result' && rejected.result.proposals.length === 0)

  let calls = 0
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['get_floor_layout', 'propose_staircase'])
    assert.ok(Buffer.byteLength(String(init?.body)) < 4000)
    return Response.json({ status: 'completed', output: [modelCall('propose_staircase', args, 'new-stair')] })
  })
  const { last } = await run(request, provider)
  assert.equal(calls, 1)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing stair preview')
  const [preview] = last.result.proposals
  assert.ok(preview, JSON.stringify(last.result.report.trace))
  const [operation] = preview.operations
  assert.ok(operation.type === 'add-stair' && operation.layout !== 'straight')
  assert.ok(parseAgentRequest(JSON.parse(JSON.stringify({ ...request, previous: preview })))?.previous)
  const [lower] = captureArchitecturalScene(request.source).floors
  const edits = validateProposal(request.source, lower, preview)
  assert.ok(edits?.stair)
  assert.equal(edits.stair.definition.stairDesign?.totalRise, 2.7)
  assert.equal(edits.stair.upperFloorId, 'upstairs')
  assert.ok(edits.stair.openings.length)
  const appliedSource = { ...request.source, models: [...request.source.models, edits.stair.definition],
    floors: [materializeFloorEdits(request.source.floors[0], edits), request.source.floors[1]] }
  const installed = captureArchitecturalScene(appliedSource)
  assert.equal(installed.floors[0].stairIds[0], operation.id)
  assert.deepEqual(installed.floors[1].stairsFromBelow[0].openings, edits.stair.openings)
  assert.equal(request.source.floors[0].models.length, 0)
  assert.equal(validateProposal(request.source, lower, { ...preview, operations: [{ ...operation, position: point(20, 20) }]}), null)
})

test('a two-storey wraparound uses the front entrance for orientation and adds an accessible slab to both floors', async () => {
  const request = fixture()
  request.mode = 'live'
  request.prompt = 'Extend the house 4 m out the back and 2 m to the right over two storeys.'
  request.source.floors[0].walls[0].openings = [{ id: 'front-entrance', modelId: frontDoor.id, center: 5, width: .97, height: 2.1, bottom: 0 }]
  request.source.models.push(frontDoor)
  const unrelated = { ...request.source.floors[1], id: 'loft', name: 'Loft', elevation: 5.4 }
  request.source.floors.push(unrelated)
  const original = structuredClone(request.source)
  let calls = 0
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.tools[0].parameters.properties.operation.enum, ['get_extension_site', 'propose_extension'])
    if (++calls === 1) return Response.json({ status: 'completed', output: [modelCall('get_extension_site', { floorId: 'ground' }, 'site')] })
    const site = JSON.parse(body.input.at(-1).output).value as { frontDoorWallId: string; facades: Array<{ wallId: string; direction: string }> }
    assert.equal(site.frontDoorWallId, 'outer-0')
    const rear = site.facades.find(facade => facade.direction === 'rear')!
    const right = site.facades.find(facade => facade.direction === 'right')!
    assert.equal(rear.wallId, 'outer-2')
    assert.equal(right.wallId, 'outer-3')
    return Response.json({ status: 'completed', output: [modelCall('propose_extension',
      { floorId: 'ground', upperFloorId: 'upstairs', spans: [{ wallId: rear.wallId, depth: 4 }, { wallId: right.wallId, depth: 2 }] }, 'wraparound')] })
  })
  const { last } = await run(request, provider)
  assert.equal(calls, 2)
  assert.ok(last?.type === 'result')
  const [preview] = last.result.proposals
  assert.ok(preview, JSON.stringify(last.result.report.trace))
  assert.match(last.result.message, /Two-storey wraparound extension/)
  const saved = parseAgentRequest(JSON.parse(JSON.stringify({ ...request, previous: preview })))?.previous
  assert.ok(saved)
  const scene = captureArchitecturalScene(request.source)
  const edits = validateProposal(request.source, scene.floors[0], saved)
  assert.ok(edits?.additionalFloors?.length)
  const floors = materializeProposalFloors(request.source.floors, preview.floorId, edits)
  assert.ok(floors)
  assert.equal(floors[2], unrelated)
  const completed = captureArchitecturalScene({ ...request.source, floors })
  for (const [index, floor] of floors.slice(0, 2).entries()) {
    const added = floor.walls.filter(wall => !request.source.floors[index].walls.some(original => original.id === wall.id))
    assert.deepEqual(bounds(added.flatMap(wall => [wall.start, wall.end])), { minX: -2, minY: 0, maxX: 12, maxY: 14 })
    const level = completed.floors[index]
    assert.ok(floor.floorFootprints && area(floor.floorFootprints.map(polygon)) > area(scene.floors[index].footprint.map(polygon)))
    const extension = level.rooms.find(room => room.name === 'Extension')
    assert.ok(extension)
    assert.ok(openingConnections(floor.walls, level.rooms).some(link => link.from && link.to && [link.from, link.to].includes(extension.id)))
  }
  assert.ok(completed.floors[0].openings.some(opening => opening.id === 'front-entrance'))
  assert.deepEqual(completed.floors[1].stairsFromBelow.map(stair => stair.openings), scene.floors[1].stairsFromBelow.map(stair => stair.openings))
  assert.deepEqual(request.source, original)
  const [op] = preview.operations
  assert.ok(op.type === 'add-extension')
  assert.equal(validateProposal(request.source, scene.floors[0], { ...preview, operations: [{ ...op, upperFloorId: 'loft' }] }), null)

  const revise = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const active = JSON.parse(body.input[0].content).context.activeProposal
    assert.deepEqual(active.extension.spans, op.spans)
    return Response.json({ status: 'completed', output: [modelCall('propose_extension', {
      floorId: active.floorId, upperFloorId: active.extension.upperFloorId,
      spans: [{ ...active.extension.spans[0], depth: 3 }, active.extension.spans[1]],
    }, 'revised-extension')] })
  })
  const revised = (await run({ ...request, previous: saved, prompt: 'Could we make the rear 3 m instead?' }, revise)).last
  assert.ok(revised?.type === 'result' && revised.result.proposals[0], JSON.stringify(revised))
  const changes = revised.result.proposals[0].operations[0]
  assert.ok(changes.type === 'add-extension')
  assert.deepEqual(changes.spans.map(span => span.depth), [3, 2])
})

test('a measured north/east footprint-only brief does not contact the provider', async () => {
  const request = fixture()
  request.mode = 'live'
  request.prompt = 'Extend the north side by 4m and the east side by 2.5m as a single-storey wraparound extension.'
  const provider: AgentProvider = { start() { throw new Error('A measured footprint should use local geometry.') } }
  const [ground] = captureArchitecturalScene(request.source).floors
  const { last } = await run(request, provider)
  assert.ok(last?.type === 'result', JSON.stringify(last))
  assert.equal(last.result.report.inputTokens, 0)
  const [preview] = last.result.proposals
  assert.ok(preview, last.result.message)
  const [operation] = preview.operations
  assert.ok(operation.type === 'add-extension')
  assert.equal(operation.upperFloorId, null)
  assert.deepEqual(operation.spans, [{ wallId: 'outer-0', depth: 4 }, { wallId: 'outer-1', depth: 2.5 }])
  const edits = validateProposal(request.source, ground, preview)
  assert.ok(edits)
  const additions = edits.walls.filter(wall => !request.source.floors[0].walls.some(prior => prior.id === wall.id))
  assert.deepEqual(bounds(additions.flatMap(wall => [wall.start, wall.end])), { minX: 0, minY: -4, maxX: 14.5, maxY: 10 })

  request.source.floors[0].walls.push({ ...wall(13, 1, 15, 1), id: 'boundary-in-extension', kind: 'external', thickness: 0.15, height: 2 })
  const blocked = (await run(request, provider)).last
  assert.ok(blocked?.type === 'result')
  assert.equal(blocked.result.proposals.length, 0)
  assert.match(blocked.result.message, /conflicts with an existing wall/)
})

test('a second storey fits over an applied wraparound even with recessed original upper walls', async () => {
  const request = fixture()
  const inset = ({ x, y }: Point) => point(x === 0 ? 0.4 : x - 0.7, y === 0 ? 0.25 : y - 0.4)
  request.source.floors[1].walls = request.source.floors[1].walls.map(wall =>
    ({ ...wall, start: inset(wall.start), end: inset(wall.end) }))
  request.mode = 'live'
  request.prompt = 'Extend the north side by 4m and the east side by 2.5m as a wraparound extension.'
  const localOnly: AgentProvider = { start() { throw new Error('The extension should use local geometry.') } }
  const original = await run(request, localOnly)
  assert.ok(original.last?.type === 'result')
  const [singleStorey] = original.last.result.proposals
  assert.ok(singleStorey, original.last.result.message)
  const initial = captureArchitecturalScene(request.source)
  const lowerEdits = validateProposal(request.source, initial.floors[0], singleStorey)
  assert.ok(lowerEdits)

  const correction = { ...request, prompt: 'sorry, I meant a two-storey extension' }
  const pending = (await run({ ...correction, previous: singleStorey }, localOnly)).last
  assert.ok(pending?.type === 'result')
  const [both] = pending.result.proposals
  assert.ok(both, pending.result.message)
  assert.ok(validateProposal(request.source, initial.floors[0], both)?.additionalFloors?.length)

  const applied = { ...request.source, revision: 'applied', floors: [
    materializeFloorEdits(request.source.floors[0], lowerEdits), request.source.floors[1],
  ] }
  const saved = structuredClone(applied)
  const { last } = await run({ ...correction, source: applied }, localOnly)
  assert.ok(last?.type === 'result')
  const [preview] = last.result.proposals
  assert.ok(preview, last.result.message)
  assert.equal(preview.floorId, 'upstairs')
  assert.equal(preview.operations[0].type, 'extend-above')
  const prior = parseAgentRequest(JSON.parse(JSON.stringify({ ...correction, source: applied, previous: preview })))?.previous
  assert.ok(prior)
  const scene = captureArchitecturalScene(applied)
  const upperEdits = validateProposal(applied, scene.floors[1], prior)
  assert.ok(upperEdits && !upperEdits.additionalFloors)
  const floors = materializeProposalFloors(applied.floors, preview.floorId, upperEdits)
  assert.ok(floors)
  assert.equal(floors[0], applied.floors[0])
  const outline = bounds(upperEdits.walls.flatMap(wall => [wall.start, wall.end]))
  assert.equal(outline.minY, -4)
  assert.ok(Math.abs(outline.maxX - 14.5) < 0.0001)
  const repeated = (await run({ ...correction, source: applied, prompt: `${request.prompt} Make it two storeys.` }, localOnly)).last
  assert.ok(repeated?.type === 'result')
  assert.equal(repeated.result.proposals[0]?.operations[0].type, 'extend-above')
  const completed = captureArchitecturalScene({ ...applied, floors })
  assert.deepEqual(completed.floors[1].stairsFromBelow.map(stair => stair.openings), scene.floors[1].stairsFromBelow.map(stair => stair.openings))
  assert.deepEqual(applied, saved)
})

test('single-storey additions work on all four sides and a non-adjoining wraparound is rejected', async () => {
  const request = fixture()
  for (const wallId of ['outer-0', 'outer-1', 'outer-2', 'outer-3']) {
    const model = script(async function* (call) {
      yield call('propose_extension', { floorId: 'ground', upperFloorId: null, spans: [{ wallId, depth: 2.5 }] })
      return { message: 'No preview.' }
    })
    const { last } = await run(request, model)
    assert.ok(last?.type === 'result')
    const [preview] = last.result.proposals
    assert.ok(preview, JSON.stringify(last.result.report.trace))
    const edits = validateProposal(request.source, captureArchitecturalScene(request.source).floors[0], preview)
    assert.ok(edits && !edits.additionalFloors)
    assert.equal(materializeProposalFloors(request.source.floors, preview.floorId, edits)?.[1], request.source.floors[1])
  }
  const model = script(async function* (call) {
    const result = yield call('propose_extension', { floorId: 'ground', upperFloorId: null,
      spans: [{ wallId: 'outer-0', depth: 2 }, { wallId: 'outer-2', depth: 3 }] })
    assert.ok(result && !result.ok && /adjoining perpendicular/.test(result.message))
    return { message: 'Choose adjoining walls.' }
  })
  const { last } = await run(request, model)
  assert.ok(last?.type === 'result' && last.result.proposals.length === 0)
})

test('a front extension carries an existing front entrance out to the new facade', async () => {
  const request = fixture()
  request.source.models.push(frontDoor)
  request.source.floors[0].walls[0].openings = [{ id: 'front-entrance', modelId: frontDoor.id, center: 5, width: .97, height: 2.1, bottom: 0 }]
  const model = script(async function* (call) {
    yield call('propose_extension', { floorId: 'ground', upperFloorId: null, spans: [{ wallId: 'outer-0', depth: 2.5 }] })
    return { message: 'No preview.' }
  })
  const { last } = await run(request, model)
  assert.ok(last?.type === 'result')
  const [preview] = last.result.proposals
  assert.ok(preview, JSON.stringify(last.result.report.trace))
  const [ground] = captureArchitecturalScene(request.source).floors
  const edits = validateProposal(request.source, ground, preview)
  assert.ok(edits)
  assert.deepEqual(edits.models.map(model => model.modelId), [frontDoor.id])
  const floor = materializeFloorEdits(request.source.floors[0], edits)
  assert.equal(floor.walls.find(wall => wall.id === 'outer-0')?.kind, 'internal')
  const addedEntrance = floor.walls.find(wall => wall.id === edits.models[0].wallAttachment?.wallId)
  assert.ok(addedEntrance?.kind === 'external' && addedEntrance.start.y === -2.5 && addedEntrance.end.y === -2.5)
})

test('a preferred lower approach guides staircase placement and the upper floor must overlap', async () => {
  const request = fixture()
  request.source.floors[0].models = []
  const near = point(1, 2)
  const plan = script(async function* (call) {
    yield call('propose_staircase', { floorId: 'ground', upperFloorId: 'upstairs', near, layout: 'auto', width: 1 })
    return { message: 'A staircase is ready to preview.' }
  })
  const { last } = await run({ ...request, mode: 'live' }, plan)
  assert.ok(last?.type === 'result' && last.result.proposals[0])
  const edits = validateProposal(request.source, captureArchitecturalScene(request.source).floors[0], last.result.proposals[0])
  assert.ok(edits?.stair)
  const start = getStairLandingPosition(edits.models[0], edits.stair.definition, 'lower')
  assert.ok(Math.hypot(start.x - near.x, start.y - near.y) < 1)

  const upper = request.source.floors[1]
  request.source.floors[1] = { ...upper, walls: upper.walls.map(wall =>
    ({ ...wall, start: { ...wall.start, x: wall.start.x + 30 }, end: { ...wall.end, x: wall.end.x + 30 } })) }
  const blocked = (await run({ ...request, mode: 'live' }, plan)).last
  assert.ok(blocked?.type === 'result')
  assert.deepEqual(blocked.result.proposals, [])
  assert.equal(blocked.result.report.trace[0].result.ok, false)
})

test('Responses transport validates the arguments inside the compact tool call', async () => {
  let turns = 0
  const transport = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (!turns++) return Response.json({ status: 'completed', output: [{
      ...modelCall('get_floor_layout', { floorId: 'upstairs', draftId: null }, 'malformed'),
      arguments: JSON.stringify({ operation: 'get_floor_layout', argumentsJson: '{"floorId":7,"draftId":null}' }),
    }] })
    assert.equal(body.input.at(-1).call_id, 'malformed')
    assert.equal(JSON.parse(body.input.at(-1).output).code, 'invalid_arguments')
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: '{"message":"Could not read the floor.","selection":null}' },
    ] }] })
  })
  const { last } = await run({ ...fixture(), mode: 'live' }, transport)
  assert.equal(turns, 2)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing transport result')
  assert.deepEqual(last.result.proposals, [])
  assert.equal(last.result.report.trace[0].arguments, null)
})

test('Responses transport returns structured tool results and handles an interrupted response', async () => {
  let turns = 0
  const transport = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.store, false)
    assert.equal(body.tools[0].strict, true)
    assert.equal(body.tools[0].name, 'house_design')
    if (!turns++) return Response.json({ status: 'completed',
      output: [modelCall('get_floor_layout', { floorId: 'upstairs', draftId: null }, 'floor-1')],
      usage: { input_tokens: 90, output_tokens: 11 } })
    assert.equal(body.input.at(-1).type, 'function_call_output')
    assert.equal(body.input.at(-1).call_id, 'floor-1')
    const result = JSON.parse(body.input.at(-1).output)
    assert.equal(result.value.walls.length, 4)
    return Response.json({ status: 'incomplete', output: [] })
  })
  const { last } = await run({ ...fixture(), mode: 'live' }, transport)
  assert.equal(turns, 2)
  assert.equal(last?.type, 'error')
  if (last.type !== 'error') throw new Error('missing transport error')
  assert.match(last.text, /ended before it finished/)
  assert.equal(last.report?.trace[0].tool, 'get_floor_layout')
  assert.equal(last.report?.inputTokens, 90)
})

test('Responses transport retries a connection setup failure and reports an interrupted connection without replaying it', async () => {
  for (const code of ['EAI_AGAIN', 'ECONNRESET']) {
    let calls = 0
    const provider = createOpenAiDesignAgent('test-key', 'test-model', async () => {
      if (++calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('private transport detail'), { code }) })
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [
        { type: 'output_text', text: '{"message":"Connected.","selection":null}' },
      ] }] })
    })
    const { last } = await run({ ...fixture(), mode: 'live' }, provider)
    if (code === 'EAI_AGAIN') {
      assert.equal(calls, 2)
      assert.equal(last?.type, 'result')
    } else {
      assert.equal(calls, 1)
      assert.equal(last?.type, 'error')
      assert.match(last.text, /\(ECONNRESET\)/)
      assert.doesNotMatch(last.text, /private transport detail/)
    }
  }
})

test('Responses transport keeps native precision in diagnostics and reports the model output limit with usage', async () => {
  const width = 12.123456789
  let turns = 0
  const reasoning = { type: 'reasoning', id: 'rs_test', encrypted_content: 'reasoning-fixture', summary: [] }
  const provider = createOpenAiDesignAgent('test-key', 'test-model', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (!turns++) return Response.json({ status: 'completed', output: [reasoning,
      modelCall('get_floor_layout', { floorId: 'upstairs', draftId: null }, 'floor-precision')],
    usage: { input_tokens: 3000, output_tokens: 60 } })
    assert.deepEqual(body.input[1], reasoning)
    const result = JSON.parse(body.input.at(-1).output)
    assert.equal(result.value.walls[0].end.x, 12.1235)
    return Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
      usage: { input_tokens: 4200, output_tokens: 1600 } })
  })
  const limits = { ...defaultAgentLimits, inputTokens: 8_000, outputTokens: 2_200 }
  const { last, events } = await run({ ...fixture(width), mode: 'live' }, provider, limits)
  if (last?.type !== 'result') throw new Error(last?.type === 'error' ? last.text : 'missing token limit result')
  assert.equal(last.result.report.stop, 'model response token limit')
  assert.equal(last.result.report.inputTokens, 7200)
  assert.equal(last.result.report.outputTokens, 1660)
  assert.deepEqual(events.flatMap(event => event.type === 'phase' && event.usage ? [event.usage] : []), [
    { inputTokens: 0, outputTokens: 0, inputTokenLimit: 8_000, outputTokenLimit: 2_200 },
    { inputTokens: 3000, outputTokens: 60, inputTokenLimit: 8_000, outputTokenLimit: 2_200 },
    { inputTokens: 7200, outputTokens: 1660, inputTokenLimit: 8_000, outputTokenLimit: 2_200 },
  ])
  assert.equal(get<{ walls: Wall[] }>(last.result.report.trace[0].result).walls[0].end.x, width)
})

test('the editor receives live token usage before the final design response', async t => {
  const encoder = new TextEncoder()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { stream = controller },
  })))
  const usage = { inputTokens: 1_200, outputTokens: 80, inputTokenLimit: 75_000, outputTokenLimit: 7_000 }
  const update = Promise.withResolvers<typeof usage>()
  const pending = requestDesignAgent({ ...fixture(), mode: 'live' }, new AbortController().signal, event => {
    if (event.usage) update.resolve(event.usage)
  })
  const line = JSON.stringify({ type: 'phase', text: 'Checking the layout…', usage }) + '\n'
  stream.enqueue(encoder.encode(line.slice(0, 40)))
  stream.enqueue(encoder.encode(line.slice(40)))
  assert.deepEqual(await update.promise, usage)

  const result = { message: 'Layout checked.', selection: null, proposals: [],
    report: { trace: [], milliseconds: 50, inputTokens: 1_200, outputTokens: 80, stop: 'completed' } }
  stream.enqueue(encoder.encode(JSON.stringify({ type: 'result', result }) + '\n'))
  stream.close()
  assert.deepEqual(await pending, result)
})

test('workspace heartbeats keep the editor connected and a silent stream can be retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const encoder = new TextEncoder()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { stream = controller },
    cancel() { cancelled = true },
  })))
  const ready = Promise.withResolvers<void>()
  const pending = requestDesignAgent({ ...fixture(), mode: 'live' }, new AbortController().signal, () => ready.resolve())
  const failure = assert.rejects(pending, error =>
    error instanceof AgentRequestError && error.retryable && /stopped receiving updates/.test(error.message))
  stream.enqueue(encoder.encode('{"type":"phase","text":"Waiting for OpenAI…"}\n'))
  await ready.promise
  t.mock.timers.tick(24_000)
  stream.enqueue(encoder.encode('{"type":"heartbeat"}\n'))
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(24_000)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(cancelled, false)
  t.mock.timers.tick(1_000)
  await failure
  assert.equal(cancelled, true)
})
