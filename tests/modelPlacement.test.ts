import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPlacedModel,
  getModelOpenings,
  syncWallOpenings,
  updateWallAttachedModels,
} from '../src/modelPlacement.ts'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const modelsById = new Map<string, ModelDefinition>([
  [
    'window',
    {
      id: 'window',
      name: 'Window',
      category: 'Windows',
      color: '#2563eb',
      depth: 0.08,
      height: 1.1,
      shape: 'box',
      wallMount: 'window',
      width: 1.09,
    },
  ],
  [
    'patio-doors-side-lights',
    {
      id: 'patio-doors-side-lights',
      name: 'Patio Doors Side Lights',
      category: 'Doors',
      color: '#2563eb',
      depth: 0.08,
      height: 2.08,
      shape: 'box',
      wallMount: 'patio-door',
      width: 2.54,
    },
  ],
])

const wall: Wall = {
  id: 'wall-1',
  kind: 'external',
  start: { x: 0, y: 0 },
  end: { x: 5, y: 0 },
  thickness: 0.3,
  height: 2.4,
}

test('creates a wall-mounted model from the plan center', () => {
  const model = createPlacedModel({
    id: 'model-1',
    modelId: 'window',
    modelsById,
    walls: [wall],
  })

  assert.deepEqual(model.position, { x: 2.5, y: 0 })
  assert.equal(model.rotation, 0)
  assert.deepEqual(model.wallAttachment, {
    wallId: 'wall-1',
    offset: 2.5,
  })
})

test('calculates window opening dimensions from model metadata', () => {
  const model: PlacedModel = {
    id: 'window-1',
    modelId: 'window',
    position: { x: 2.5, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'wall-1',
      offset: 2.5,
    },
  }

  assert.deepEqual(getModelOpenings(model, wall, modelsById), [
    {
      id: 'window-1',
      modelId: 'window',
      center: 2.5,
      width: 1.09,
      bottom: 0.9,
      height: 1.1,
    },
  ])
})

test('splits patio doors with side lights into separate openings', () => {
  const model: PlacedModel = {
    id: 'patio-1',
    modelId: 'patio-doors-side-lights',
    position: { x: 2.5, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'wall-1',
      offset: 2.5,
    },
  }

  const openings = getModelOpenings(model, wall, modelsById)

  assert.equal(openings.length, 3)
  assert.deepEqual(openings.map((opening) => opening.id), [
    'patio-1:left-side-light',
    'patio-1:doors',
    'patio-1:right-side-light',
  ])
  assert.equal(openings[1].width, 1.62)
  assert.equal(openings[1].bottom, 0)
})

test('syncs model openings while preserving manual openings', () => {
  const model: PlacedModel = {
    id: 'window-1',
    modelId: 'window',
    position: { x: 2.5, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'wall-1',
      offset: 2.5,
    },
  }
  const floor: FloorLevel = {
    id: 'floor-1',
    name: 'Floor 0',
    elevation: 0,
    models: [model],
    rooms: [],
    roomHeight: 2.4,
    slabThickness: 0.3,
    walls: [
      {
        ...wall,
        openings: [
          {
            id: 'manual-opening',
            modelId: 'manual',
            center: 1,
            width: 0.4,
            bottom: 0,
            height: 2,
          },
        ],
      },
    ],
  }

  const syncedFloor = syncWallOpenings(floor, modelsById)
  const openings = syncedFloor.walls[0].openings ?? []

  assert.deepEqual(openings.map((opening) => opening.id), [
    'manual-opening',
    'window-1',
  ])
})

test('moves attached models when their wall geometry changes', () => {
  const model: PlacedModel = {
    id: 'window-1',
    modelId: 'window',
    position: { x: 2.5, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'wall-1',
      offset: 2.5,
    },
  }
  const movedWall: Wall = {
    ...wall,
    start: { x: 0, y: 1 },
    end: { x: 0, y: 6 },
  }

  const [movedModel] = updateWallAttachedModels([model], movedWall)

  assert.deepEqual(movedModel.position, { x: 0, y: 3.5 })
  assert.equal(movedModel.rotation, Math.PI / 2)
  assert.equal(movedModel.wallAttachment?.offset, 2.5)
})
