import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPlacedModel,
  getWallMountForPoint,
  getModelOpenings,
  normalizeFloor,
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
    'panel-interior-door-closed',
    {
      id: 'panel-interior-door-closed',
      name: 'Panel Interior Door Closed',
      category: 'Doors',
      color: '#2563eb',
      depth: 0.19917,
      height: 2.124037,
      openingWidth: 0.975141,
      shape: 'box',
      wallMount: 'interior-door',
      width: 0.975141,
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

test('normalizes lean-to roof structures on loaded floors', () => {
  const floor = {
    id: 'floor-1',
    name: 'Floor 1',
    elevation: 2.7,
    models: [],
    rooms: [],
    roomHeight: 2.4,
    slabThickness: 0.3,
    walls: [wall],
    roofs: [
      {
        depth: 3,
        heightOffset: 0.45,
        id: 'roof-1',
        pitchDegrees: 32,
        position: { x: 2, y: 1 },
        rotation: 0,
        type: 'lean-to',
        width: 5,
      },
    ],
  } satisfies FloorLevel

  const [roof] = normalizeFloor(floor, modelsById).roofs

  assert.equal(roof.type, 'lean-to')
  assert.equal(roof.heightOffset, 0.45)
})

test('roof overhang pitch and soffit colour survive saving and normalization', () => {
  const floor = {
    id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4,
    slabThickness: 0.2, walls: [], rooms: [], models: [],
    roofs: [{
      id: 'roof', type: 'up-and-over', width: 7, depth: 9,
      pitchDegrees: 37, overhangPitchDegrees: 22, soffitColor: '#345678',
      position: { x: 0, y: 0 }, rotation: 0,
    }],
  } satisfies FloorLevel
  const saved = JSON.parse(JSON.stringify(floor)) as FloorLevel
  const [roof] = normalizeFloor(saved, modelsById).roofs
  assert.equal(roof.overhangPitchDegrees, 22)
  assert.equal(roof.soffitColor, '#345678')

  const legacy = { ...floor, roofs: [{ ...floor.roofs[0], overhangPitchDegrees: undefined, soffitColor: undefined }] }
  const [legacyRoof] = normalizeFloor(legacy, modelsById).roofs
  assert.equal(legacyRoof.overhangPitchDegrees, undefined)
  assert.equal(legacyRoof.soffitColor, undefined)

  for (const [input, expected] of [[-1, 0], [90, 75], [NaN, undefined]] as const) {
    const [normalized] = normalizeFloor({ ...floor, roofs: [{ ...floor.roofs[0], overhangPitchDegrees: input, soffitColor: 'invalid' }] }, modelsById).roofs
    assert.equal(normalized.overhangPitchDegrees, expected)
    assert.equal(normalized.soffitColor, undefined)
  }
})

test('creates a wall-mounted model from the plan center', () => {
  const model = createPlacedModel({
    id: 'model-1',
    modelId: 'window',
    modelsById,
    walls: [wall],
  })

  assert.deepEqual(model.position, { x: 2.5, y: 0 })
  assert.equal(model.rotation, 0)
  assert.equal(model.flipped, false)
  assert.equal(model.mirrored, false)
  assert.deepEqual(model.wallAttachment, {
    wallId: 'wall-1',
    offset: 2.5,
    side: 1,
  })
})

test('ridge connections and gable chamfers survive a save/load round trip', () => {
  const floor: FloorLevel = { id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4,
    slabThickness: 0.2, walls: [], rooms: [], models: [], roofs: [{
      id: 'roof', type: 'up-and-over', width: 4, depth: 6, pitchDegrees: 37,
      position: { x: 0, y: 0 }, rotation: 0,
      ridgeStart: { mode: 'exposed' }, ridgeEnd: { mode: 'join', targetRoofId: 'roof-on-another-floor' },
      ridgeStartChamfer: { angleDegrees: 37, distance: 0.8 },
      ridgeEndChamfer: { angleDegrees: 22, distance: 1.2 },
    }] }
  const saved = JSON.parse(JSON.stringify(floor)) as FloorLevel
  const [roof] = normalizeFloor(saved, modelsById).roofs
  assert.deepEqual(roof.ridgeStart, floor.roofs![0].ridgeStart)
  assert.deepEqual(roof.ridgeEnd, floor.roofs![0].ridgeEnd)
  assert.deepEqual(roof.ridgeStartChamfer, floor.roofs![0].ridgeStartChamfer)
  assert.deepEqual(roof.ridgeEndChamfer, floor.roofs![0].ridgeEndChamfer)
})

test('normalization removes floating point drift from cardinal roof rotations', () => {
  const floor: FloorLevel = { id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4,
    slabThickness: 0.2, walls: [], rooms: [], models: [], roofs: [{
      id: 'roof', type: 'up-and-over', width: 4, depth: 6, pitchDegrees: 37,
      position: { x: 0, y: 0 }, rotation: Math.PI + 0.00000008,
    }] }
  const [roof] = normalizeFloor(floor, modelsById).roofs
  assert.equal(roof.rotation, Math.PI)
})

test('wall-mounted models remember the side of the wall they were placed from', () => {
  const positiveSideMount = getWallMountForPoint({ x: 2.5, y: 0.2 }, [wall])
  const negativeSideMount = getWallMountForPoint({ x: 2.5, y: -0.2 }, [wall])

  assert.deepEqual(positiveSideMount?.wallAttachment, {
    wallId: 'wall-1',
    offset: 2.5,
    side: 1,
  })
  assert.equal(positiveSideMount?.rotation, 0)
  assert.deepEqual(negativeSideMount?.wallAttachment, {
    wallId: 'wall-1',
    offset: 2.5,
    side: -1,
  })
  assert.equal(negativeSideMount?.rotation, Math.PI)
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

test('uses moved wall opening bottom for window cutouts', () => {
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
    wallOpeningBottom: 1.2,
  }

  assert.deepEqual(getModelOpenings(model, wall, modelsById), [
    {
      id: 'window-1',
      modelId: 'window',
      center: 2.5,
      width: 1.09,
      bottom: 1.2,
      height: 1.1,
    },
  ])
})

test('clamps moved window cutouts inside the wall height', () => {
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
    wallOpeningBottom: 2.3,
  }

  assert.deepEqual(getModelOpenings(model, wall, modelsById), [
    {
      id: 'window-1',
      modelId: 'window',
      center: 2.5,
      width: 1.09,
      bottom: 2.1,
      height: 0.3,
    },
  ])
})

test('calculates panel door opening from model-specific bounds', () => {
  const model: PlacedModel = {
    id: 'panel-door-1',
    modelId: 'panel-interior-door-closed',
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
      id: 'panel-door-1',
      modelId: 'panel-interior-door-closed',
      center: 2.5,
      width: 0.975141,
      bottom: 0,
      height: 2.124037,
    },
  ])
})

test('calculates wall-mounted openings from the model position when attachment offset is stale', () => {
  const model: PlacedModel = {
    id: 'panel-door-1',
    modelId: 'panel-interior-door-closed',
    position: { x: 3.25, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'wall-1',
      offset: 1,
    },
  }

  assert.deepEqual(getModelOpenings(model, wall, modelsById), [
    {
      id: 'panel-door-1',
      modelId: 'panel-interior-door-closed',
      center: 3.25,
      width: 0.975141,
      bottom: 0,
      height: 2.124037,
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

test('splits wall-mounted openings across adjacent collinear wall segments', () => {
  const model: PlacedModel = {
    id: 'panel-door-1',
    modelId: 'panel-interior-door-closed',
    position: { x: 2.2, y: 0 },
    rotation: 0,
    scale: 1,
    wallAttachment: {
      wallId: 'right-wall',
      offset: 0.2,
      side: 1,
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
        id: 'left-wall',
        kind: 'internal',
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
        thickness: 0.1,
      },
      {
        ...wall,
        id: 'right-wall',
        kind: 'internal',
        start: { x: 2, y: 0 },
        end: { x: 5, y: 0 },
        thickness: 0.1,
      },
    ],
  }

  const syncedFloor = syncWallOpenings(floor, modelsById)

  assert.deepEqual(syncedFloor.walls[0].openings, [
    {
      id: 'panel-door-1:wall:left-wall',
      modelId: 'panel-interior-door-closed',
      center: 1.8562147500000001,
      width: 0.28757049999999973,
      bottom: 0,
      height: 2.124037,
    },
  ])
  assert.deepEqual(syncedFloor.walls[1].openings, [
    {
      id: 'panel-door-1',
      modelId: 'panel-interior-door-closed',
      center: 0.34378525000000004,
      width: 0.6875705000000001,
      bottom: 0,
      height: 2.124037,
    },
  ])
})

test('syncs doors independently on joined internal wall segments', () => {
  const floor: FloorLevel = {
    id: 'floor-1',
    name: 'Floor 0',
    elevation: 0,
    models: [
      {
        id: 'left-door',
        modelId: 'panel-interior-door-closed',
        position: { x: 0.8, y: 0 },
        rotation: 0,
        scale: 1,
        wallAttachment: {
          wallId: 'left-wall',
          offset: 0.8,
          side: 1,
        },
      },
      {
        id: 'right-door',
        modelId: 'panel-interior-door-closed',
        position: { x: 3.5, y: 0 },
        rotation: 0,
        scale: 1,
        wallAttachment: {
          wallId: 'right-wall',
          offset: 1.5,
          side: 1,
        },
      },
    ],
    rooms: [],
    roomHeight: 2.4,
    slabThickness: 0.3,
    walls: [
      {
        ...wall,
        id: 'left-wall',
        kind: 'internal',
        start: { x: 0, y: 0 },
        end: { x: 1.63, y: 0 },
        thickness: 0.1,
      },
      {
        ...wall,
        id: 'right-wall',
        kind: 'internal',
        start: { x: 1.63, y: 0 },
        end: { x: 4.75, y: 0 },
        thickness: 0.1,
      },
    ],
  }

  const syncedFloor = syncWallOpenings(floor, modelsById)

  assert.deepEqual(
    (syncedFloor.walls[0].openings ?? []).map((opening) => opening.id),
    ['left-door'],
  )
  assert.deepEqual(
    (syncedFloor.walls[1].openings ?? []).map((opening) => opening.id),
    ['right-door'],
  )
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
