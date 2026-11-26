import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { mockProvider } from '../src/assistant/intent.ts'
import { planLayout } from '../src/assistant/layoutPlanner.ts'
import { validateAndMaterialize } from '../src/assistant/layoutValidation.ts'
import { ASSISTANT_DOOR_MODEL, captureArchitecturalScene, makeSceneSource } from '../src/assistant/scene.ts'
import type { FloorLevel, Point, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'

const door: ModelDefinition = { id: ASSISTANT_DOOR_MODEL, name: 'Interior door', category: 'Doors', color: 'white',
  wallMount: 'interior-door', shape: 'box', height: 2.124037, width: 0.975141, openingWidth: 0.975141, depth: 0.2 }
const stair: ModelDefinition = { id: 'simple-stairs', name: 'Stair', category: 'Stairs', color: 'white',
  objectType: 'stairs', shape: 'box', height: 2.7, width: 0.9, depth: 2.8 }

function fixture(width = 11.6, depth = 9.2, notch = false) {
  const ring: Point[] = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth },
    ...(notch ? [{ x: 2.4, y: depth }, { x: 2.4, y: depth - 0.8 }, { x: 0, y: depth - 0.8 }] : [{ x: 0, y: depth }])]
  const walls: Wall[] = ring.map((start, index) => ({ start, end: ring[(index + 1) % ring.length], id: `exterior-${index}`,
    kind: 'external', height: 2.45, thickness: 0.3 }))
  if (width > 8) walls[0].openings = [2, 5.7, 9.7].map((center, index) => ({
    id: `window-${index}`, modelId: 'window', center, width: 0.95, bottom: 0.95, height: 1,
  }))
  const upper: FloorLevel = { id: 'upper', name: 'First floor', elevation: 2.7, walls, roomHeight: 2.45, slabThickness: 0.25, rooms: [], models: [] }
  const lower: FloorLevel = { ...upper, id: 'lower', name: 'Ground floor', elevation: 0, walls: walls.map(wall => ({ ...wall, openings: undefined })), models: [
    { id: 'stairs', modelId: stair.id, position: { x: width * 0.46, y: depth / 2 }, rotation: -Math.PI / 2, scale: 1 },
  ] }
  return makeSceneSource({ projectId: 'test', revision: '0:1:1', floors: [lower, upper],
    models: new Map([[stair.id, stair], [door.id, door]]), partitionThickness: 0.12,
    selection: { floorId: 'lower', roomSignature: null, wallIds: [], modelIds: [], roofId: null } })
}

const prompt = 'Could you design upstairs with three bedrooms, a bathroom and an airy landing?'
const interpret = (text: string, previous: Awaited<ReturnType<typeof mockProvider.interpret>>['requirements'] | null = null) =>
  mockProvider.interpret({ prompt: text, history: [], previous, previousFloor: previous ? 'upstairs' : null, options: 0 })

test('plans two editable layouts with clear access and the existing openings and stair preserved', async () => {
  const source = fixture()
  const before = structuredClone(source.floors)
  const scene = captureArchitecturalScene(source)
  const { requirements } = await interpret(prompt)
  const result = planLayout(source, scene, 'upstairs', requirements)
  assert.equal(result.proposals.length, 2, result.message)
  assert.deepEqual(source.floors, before)
  assert.equal(scene.floors[1].openings.length, 3)
  assert.equal(scene.floors[1].stairsFromBelow[0].id, 'stairs')
  const [bedrooms, landing] = result.proposals
  assert.ok(landing.metrics.landingArea > bedrooms.metrics.landingArea)
  assert.ok(bedrooms.metrics.bedroomArea > landing.metrics.bedroomArea)
  const edits = validateAndMaterialize(source, scene.floors[1], bedrooms)
  assert.ok(edits)
  assert.equal(edits.models.length, 4)
  assert.equal(edits.rooms.filter(room => room.function === 'bedroom').length, 3)
  assert.equal(edits.walls.flatMap(wall => wall.openings ?? []).length, 4)
  const floor = source.floors[1]
  const restored = normalizeFloor({ ...floor, walls: [...floor.walls, ...edits.walls], models: edits.models, rooms: edits.rooms }, new Map([[door.id, door]]))
  assert.equal(restored.walls.slice(floor.walls.length).flatMap(wall => wall.openings ?? []).length, 4)
  assert.deepEqual(bedrooms.preserved.openingIds, ['window-0', 'window-1', 'window-2'])
  assert.equal(validateAndMaterialize({ ...source, revision: '2' }, scene.floors[1], bedrooms), null)
  const edited = structuredClone(bedrooms)
  const doorway = edited.operations.find(operation => operation.type === 'create-doorway')!
  doorway.position.x += 2
  assert.equal(validateAndMaterialize(source, scene.floors[1], edited), null)
})

test('revises the selected option to make the bathroom bigger', async () => {
  const source = fixture(), scene = captureArchitecturalScene(source)
  const initial = await interpret(prompt)
  const base = planLayout(source, scene, 'upstairs', initial.requirements).proposals[0]
  assert.ok(base)
  const revision = await interpret('Could you make the bathroom a little bigger?', initial.requirements)
  assert.equal(revision.requirements.bedrooms, 3)
  assert.equal(revision.requirements.landing, 'spacious')
  const result = planLayout(source, scene, 'upstairs', revision.requirements,
    { previous: base, largerBathroom: true, largerPrimary: false, keepLanding: false })
  assert.ok(result.proposals.length > 0, result.message)
  assert.ok(result.proposals[0].metrics.bathroomArea > base.metrics.bathroomArea)
})

test('handles a simple notched floor and suggests fewer rooms for insufficient space', async () => {
  const { requirements } = await interpret('Please layout bedrooms 3 rooms and a bathroom in the upstairs area, leaving room for a landing')
  assert.equal(requirements.bedrooms, 3)
  const notched = fixture(11.6, 9.2, true)
  assert.ok(planLayout(notched, captureArchitecturalScene(notched), 'upstairs', requirements).proposals.length > 0)
  const small = fixture(5.2, 4.4)
  const result = planLayout(small, captureArchitecturalScene(small), 'upstairs', requirements)
  assert.deepEqual(result.proposals, [])
  assert.match(result.message, /2 bedrooms/)
})

test('checks nearly parallel geometry in the saved Red House upstairs', async () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_5.json', import.meta.url), 'utf8')) as {
    activeFloorId: string; floors: FloorLevel[]; modelDefinitions: ModelDefinition[]
  }
  const window: ModelDefinition = { id: 'window-three-pane', name: 'Three Pane Window', category: 'Windows', color: 'white',
    wallMount: 'window', shape: 'box', width: 1.64, height: 1.1, depth: 0.08 }
  const models = new Map([door, window, ...project.modelDefinitions].map(model => [model.id, model]))
  const source = makeSceneSource({ projectId: 'red-house', revision: '1',
    floors: project.floors.map(floor => normalizeFloor(floor, models)), models, partitionThickness: 0.15,
    selection: { floorId: project.activeFloorId, roomSignature: null, wallIds: [], modelIds: [], roofId: null } })
  const { requirements } = await interpret('Design the upstairs with three bedrooms, a good-sized bathroom and an airy landing.')
  const scene = captureArchitecturalScene(source)
  assert.equal(scene.floors[1].openings.filter(opening => opening.kind === 'window').length, 6)
  const result = planLayout(source, scene, 'upstairs', requirements)
  assert.equal(result.proposals.length, 2, result.message)
  for (const proposal of result.proposals) assert.ok(validateAndMaterialize(source, scene.floors[1], proposal))
})
