import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDormerStructuralAssembly,
  getAttachedDormerPlacement,
  getDormerOpeningPolygon,
  getDormerPlacementOnRoof,
  getMovedDormerPlacement,
  roofSupportsDormers,
} from '../src/dormerPlacement.ts'
import { getRoofWorldPointFromLocal } from '../src/roofBuildingGeometry.ts'
import type { RoofStructure } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const roof = (
  type: RoofStructure['type'],
  overrides: Partial<RoofStructure> = {},
): RoofStructure => ({
  depth: 8,
  id: `${type}-roof`,
  pitchDegrees: 45,
  position: { x: 0, y: 0 },
  rotation: 0,
  type,
  width: 8,
  ...overrides,
})

test('moving a dormer follows its roof face uphill and across, including rotated roofs', () => {
  const definition: ModelDefinition = { id: 'dormer', name: 'Dormer', category: 'Windows', color: '#fff',
    width: 1.25, height: 1.35, depth: 1.35, shape: 'box', roofMount: 'dormer' }
  for (const type of ['up-and-over', 'hip'] as const) for (const rotation of [0, 0.7]) {
    const host = roof(type, { rotation, position: { x: 10, y: 7 } })
    const attachment = { roofId: host.id, surface: 'positive-x' as const, localPosition: { x: 3.2, y: 0 } }
    const original = getAttachedDormerPlacement(host, attachment)!
    const model = { id: 'd', modelId: definition.id, ...original, scale: 1, dormerWidth: 1.5, dormerHeight: 0.6 }
    const before = structuredClone(model)
    const moved = getMovedDormerPlacement(host, model, definition, getRoofWorldPointFromLocal(host, { x: 2.8, y: 0.4 }))
    assert.ok(moved)
    assert.ok(Math.abs(moved.surfaceHeight - original.surfaceHeight - 0.4) < 1e-8)
    assert.ok(Math.abs(moved.roofAttachment.localPosition.y - 0.4) < 1e-8)
    assert.equal(moved.roofAttachment.surface, attachment.surface)
    assert.equal(moved.rotation, original.rotation)
    assert.deepEqual(model, before, 'preview must not mutate the saved attachment')
    assert.equal(getMovedDormerPlacement(host, model, definition, getRoofWorldPointFromLocal(host, { x: 0.2, y: 0 })), null,
      'the valley must not cross the ridge')
    assert.equal(getMovedDormerPlacement(host, model, definition, getRoofWorldPointFromLocal(host, { x: 3, y: 4 })), null,
      'the dormer must not cross the roof edge')
    assert.equal(getMovedDormerPlacement(host, model, definition, getRoofWorldPointFromLocal(host, { x: -3, y: 0 })), null,
      'dragging must not flip to the opposite slope')
  }
})

test('dormers are limited to up-and-over and hip roofs', () => {
  assert.equal(roofSupportsDormers(roof('up-and-over')), true)
  assert.equal(roofSupportsDormers(roof('hip')), true)
  assert.equal(roofSupportsDormers(roof('flat')), false)
  assert.equal(roofSupportsDormers(roof('lean-to')), false)
})

test('an up-and-over dormer faces its nearest eave and sits on the slope', () => {
  const left = getDormerPlacementOnRoof(
    roof('up-and-over'),
    { x: -2, y: 0 },
    1.25,
    1.35,
  )
  const right = getDormerPlacementOnRoof(
    roof('up-and-over'),
    { x: 2, y: 0 },
    1.25,
    1.35,
  )

  assert.ok(left)
  assert.ok(right)
  assert.equal(left.roofAttachment.surface, 'negative-x')
  assert.equal(right.roofAttachment.surface, 'positive-x')
  assert.ok(Math.abs(left.rotation - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(right.rotation + Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(left.surfaceHeight - 2) < 1e-9)
})

test('a hip dormer chooses the roof plane below the pointer', () => {
  const placement = getDormerPlacementOnRoof(
    roof('hip'),
    { x: 0, y: -2.5 },
    1.25,
    1.35,
  )

  assert.ok(placement)
  assert.equal(placement.roofAttachment.surface, 'negative-y')
  assert.ok(Math.abs(placement.rotation - Math.PI) < 1e-9)
  assert.ok(Math.abs(placement.surfaceHeight - 1.5) < 1e-9)
})

test('roof attachments follow roof movement and rotation', () => {
  const original = getDormerPlacementOnRoof(
    roof('up-and-over'),
    { x: -2, y: 0 },
    1.25,
    1.35,
  )
  assert.ok(original)

  const moved = getAttachedDormerPlacement(
    roof('up-and-over', {
      position: { x: 10, y: 5 },
      rotation: Math.PI / 2,
    }),
    original.roofAttachment,
  )
  assert.ok(moved)
  assert.deepEqual(moved.position, { x: 10, y: 7 })
  assert.ok(Math.abs(moved.rotation) < 1e-9)
})

test('a dormer cannot straddle a roof edge or ridge', () => {
  assert.equal(
    getDormerPlacementOnRoof(
      roof('up-and-over'),
      { x: -0.1, y: 0 },
      1.25,
      1.35,
    ),
    null,
  )
  assert.equal(
    getDormerPlacementOnRoof(
      roof('hip'),
      { x: 0, y: -2.5 },
      8,
      1.35,
    ),
    null,
  )
})

test('a dormer opening follows the placed model rotation and scale', () => {
  const definition: ModelDefinition = {
    category: 'Windows', color: '#fff', depth: 1.5, height: 1.4,
    id: 'dormer-window', name: 'Dormer Window', roofMount: 'dormer',
    shape: 'box', width: 1.2,
  }
  const polygon = getDormerOpeningPolygon({
    depthScale: 1,
    id: 'dormer-1',
    modelId: definition.id,
    position: { x: 4, y: 5 },
    rotation: Math.PI / 2,
    scale: 2,
    widthScale: 1,
  }, definition)

  assert.equal(polygon.length, 5)
  assert.ok(polygon.every(point => point.x >= 4 - 1e-8))
  assert.ok(Math.abs(Math.hypot(
    polygon[1].x - polygon[0].x,
    polygon[1].y - polygon[0].y,
  ) - 2 * definition.width) < 1e-8)
})

test('a dormer is composed from real walls, a wall opening, and a roof structure', () => {
  const definition: ModelDefinition = {
    category: 'Windows', color: '#fff', depth: 1.5, height: 1.4,
    id: 'dormer-window', name: 'Dormer Window', roofMount: 'dormer',
    shape: 'box', width: 1.2,
  }
  const windowDefinition: ModelDefinition = {
    category: 'Windows', color: '#fff', depth: 0.08, height: 1,
    id: 'window-three-pane', name: 'Window Three Pane', shape: 'box',
    wallMount: 'window', width: 1.5,
  }
  const hostRoof = roof('up-and-over', {
    pitchDegrees: 40,
    soffitColor: '#123456',
    thickness: 0.16,
  })
  const assembly = createDormerStructuralAssembly({
    definition,
    hostRoof,
    ownerId: 'dormer-1',
    wallBaseY: -3.1,
    windowDefinition,
  })

  assert.equal(assembly.walls.length, 3)
  assert.ok(assembly.walls.every(wall => wall.kind === 'external' && wall.thickness === 0.3),
    'front and cheeks use standard external walls, independently of roof tile thickness')
  assert.ok(assembly.roofHalfWidth >= definition.width / 2 + 0.15 + 0.08,
    'roof and soffit must cover the full external wall thickness')
  assert.deepEqual(
    assembly.walls.map(wall => wall.id),
    ['dormer-1:front-wall', 'dormer-1:left-cheek', 'dormer-1:right-cheek'],
  )
  assert.equal(assembly.walls[0].openings?.length, 1)
  assert.equal(assembly.walls[0].openings?.[0].modelId, windowDefinition.id)
  assert.equal(assembly.wallBaseY, -3.1)
  assert.equal(assembly.walls[0].height, assembly.wallHeight + 3.1)
  assert.equal(assembly.walls[0].openings?.[0].bottom, assembly.windowBottom + 3.1)
  assert.equal(assembly.roof.type, 'up-and-over')
  assert.equal(assembly.roof.pitchDegrees, hostRoof.pitchDegrees)
  assert.equal(assembly.roof.thickness, hostRoof.thickness)
  assert.equal(assembly.roof.soffitColor, hostRoof.soffitColor)

  const bigger = createDormerStructuralAssembly({ definition, hostRoof, ownerId: 'dormer-1', windowDefinition, width: 2.8, height: 1.9 })
  assert.equal(bigger.wallHeight, 1.9)
  assert.equal(bigger.walls[0].end.x - bigger.walls[0].start.x, 2.8)
  assert.ok(bigger.windowWidth > assembly.windowWidth)
  assert.ok(bigger.windowHeight > assembly.windowHeight)
  assert.ok(Math.abs(bigger.windowWidth / bigger.windowHeight - windowDefinition.width / windowDefinition.height) < 1e-8)
  assert.ok(bigger.depth > assembly.depth, 'the roof valley extends with the resized dormer')
  const opening = getDormerOpeningPolygon({ id: 'd', modelId: definition.id, position: { x: 0, y: 0 }, rotation: 0,
    scale: 1, dormerWidth: 2.8, dormerHeight: 1.9 }, definition, hostRoof, windowDefinition)
  assert.equal(opening[1].x - opening[0].x, 2.8)
  assert.ok(Math.abs(opening[3].y + bigger.depth) < 1e-8, 'cutout reaches the resized ridge intersection')

})
