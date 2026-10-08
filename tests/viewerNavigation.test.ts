import assert from 'node:assert/strict'
import test from 'node:test'
import type { FloorLevel, PlacedModel } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import { getViewerMovement, getViewerStairTransitions } from '../src/viewer/viewerNavigation.ts'

test('walking stays horizontal when looking up, and ignores vertical flight keys', () => {
  const movement = getViewerMovement('walk', new Set(['KeyW', 'KeyE']), [0, 0.8, -0.6], [1, 0, 0])
  assert.deepEqual(movement, [0, 0, -1])
  assert.deepEqual(getViewerMovement('walk', new Set(['KeyQ']), [0, 0, -1], [1, 0, 0]), [0, 0, 0])
})

test('flying follows pitch and supports vertical travel without moving forward', () => {
  assert.deepEqual(getViewerMovement('fly', new Set(['KeyW']), [0, 0.8, -0.6], [1, 0, 0]), [0, 0.8, -0.6])
  assert.deepEqual(getViewerMovement('fly', new Set(['KeyQ']), [0, 0, -1], [1, 0, 0]), [0, -1, 0])
  const diagonal = getViewerMovement('fly', new Set(['KeyW', 'KeyD', 'KeyE']), [0, 0, -1], [1, 0, 0])
  assert.ok(Math.abs(Math.hypot(...diagonal) - 1) < 1e-10, 'diagonal input does not increase speed')
})

test('stairs navigate to opposite landings on the adjacent floor with rotated, scaled footprints', () => {
  const stairs = { id: 'stairs', modelId: 'stair-definition', position: { x: 10, y: 20 },
    rotation: Math.PI / 2, scale: 2, widthScale: 1, depthScale: 0.5 } as PlacedModel
  const ground = { id: 'ground', name: 'Ground', elevation: 0, models: [stairs] } as FloorLevel
  const first = { id: 'first', name: 'First', elevation: 2.7, models: [] } as unknown as FloorLevel
  const loft = { id: 'loft', name: 'Loft', elevation: 5.4, models: [] } as unknown as FloorLevel
  const definition = { id: stairs.modelId, objectType: 'stairs', width: 1, depth: 4 } as ModelDefinition
  const definitions = new Map([[definition.id, definition]])
  const snapshot = JSON.stringify([ground, first, loft])
  const up = getViewerStairTransitions(ground, [loft, ground, first], definitions)
  assert.equal(up.length, 1)
  assert.equal(up[0].targetFloorId, first.id)
  assert.deepEqual(up[0].from, { x: 12, y: 20 })
  assert.deepEqual(up[0].to, { x: 8, y: 20 })
  const down = getViewerStairTransitions(first, [loft, ground, first], definitions)
  assert.equal(down.length, 1)
  assert.equal(down[0].targetFloorId, ground.id)
  assert.deepEqual(down[0].from, up[0].to)
  assert.deepEqual(down[0].to, up[0].from)
  assert.deepEqual(getViewerStairTransitions(loft, [ground, first, loft], definitions), [])
  assert.equal(JSON.stringify([ground, first, loft]), snapshot, 'tour navigation never edits the house')
})
