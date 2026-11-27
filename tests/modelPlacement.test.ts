import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Ray, Vector3 } from 'three'
import { createKitchenUnitDesign, kitchenUnitDefinition } from '../src/kitchenUnitDesign.ts'
import {
  ceilingMountFits,
  createPlacedModel,
  constrainDoorUpdate,
  doorPlacementFits,
  fitWallMountedObject,
  getDoorWallOffset,
  getCeilingMountArea,
  getWallFaceHit,
  getWallMountForPoint,
  getWallMountedObjectDisplayPoint,
  getWallMountedObjectPlacement,
  getWallMountedObjectPlacementAlongRay,
  getModelOpenings,
  getModelPositionInView,
  isWallMountedDecoration,
  normalizeFloor,
  resolveWallCabinetPlacement,
  syncWallOpenings,
  updateWallAttachedModels,
} from '../src/modelPlacement.ts'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

test('a wall cabinet can use the full rendered face at an outside corner', () => {
  const definition = kitchenUnitDefinition('cabinet', 'Wall cabinet', createKitchenUnitDesign('wall'))
  const host: Wall = { id: 'host', kind: 'external', start: { x: 0, y: 3 }, end: { x: 0, y: 0 }, thickness: .3, height: 2.4 }
  const walls = [host, { ...host, id: 'return', start: { x: -2, y: 3 }, end: host.start }]
  const attachment = { wallId: host.id, offset: .22, side: 1 as const }
  const near = (value: number | undefined, expected: number) => assert.ok(Math.abs((value ?? NaN) - expected) < 1e-8)
  const model = { id: 'cabinet', modelId: definition.id, scale: 1,
    ...fitWallMountedObject(definition, host, { ...attachment, offset: .3 }, {}, walls)! }
  const mount = getWallMountedObjectPlacement(definition, walls, { x: .151, y: 2.78 }, model)
  const floor = { walls, models: [model] }
  const definitions = new Map([[definition.id, definition]])
  const resolved = resolveWallCabinetPlacement(definition, floor, definitions, mount, model, { from: model })
  near(resolved?.wallAttachment.offset, .22)
  assert.equal(resolved?.wallAttachment.wallId, host.id)
  near(fitWallMountedObject(definition, host, { ...attachment, offset: 0 }, model, walls)?.wallAttachment.offset, .15)
  near(fitWallMountedObject(definition, host, { ...attachment, offset: 0, side: -1 }, model, walls)?.wallAttachment.offset, .45)
  const ray = new Ray(new Vector3(2, 1.55, 3.1), new Vector3(-1, 0, 0))
  near(getWallFaceHit(ray, host, 0, walls)?.attachment.offset, -.1)
  near(updateWallAttachedModels([{ ...model, ...resolved }], host, { walls, definitions })[0].wallAttachment?.offset, .22)
})

test('wall cabinets snap flush and stop fast drags while leaving separate heights and faces clear', () => {
  const definition = kitchenUnitDefinition('cabinet', 'Wall cabinet', createKitchenUnitDesign('wall'))
  const definitions = new Map([[definition.id, definition]])
  const wall: Wall = { id: 'wall', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .1, height: 3 }
  const mount = (offset: number, height = 1.4, side: 1 | -1 = 1) =>
    fitWallMountedObject(definition, wall, { wallId: wall.id, offset, side }, { height })!
  const floor = { walls: [wall], models: [{ id: 'fixed', modelId: definition.id, scale: 1, widthScale: 1.5, ...mount(3) }] }
  const edge = 3 - (.6 * 1.5 + .6) / 2
  const close = (actual: number | undefined, expected: number) => assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-8)

  const overshoot = resolveWallCabinetPlacement(definition, floor, definitions, mount(5), {}, { from: mount(1) })
  close(overshoot?.wallAttachment.offset, edge)
  const adjacent = resolveWallCabinetPlacement(definition, floor, definitions, mount(edge - .04, 1.43), {}, { snap: 'both' })
  close(adjacent?.wallAttachment.offset, edge)
  close(adjacent?.height, 1.4)
  const planSnap = resolveWallCabinetPlacement(definition, floor, definitions, mount(edge - .04, 1.43), {}, { snap: 'horizontal' })
  close(planSnap?.wallAttachment.offset, edge)
  close(planSnap?.height, 1.43)
  assert.equal(resolveWallCabinetPlacement(definition, floor, definitions, mount(3), {}, { snap: 'horizontal' }), null)

  const high = mount(5, 2.2)
  assert.deepEqual(resolveWallCabinetPlacement(definition, floor, definitions, high, {}, { from: mount(1, 2.2) }), high)
  const opposite = mount(3, 1.4, -1)
  assert.deepEqual(resolveWallCabinetPlacement(definition, floor, definitions, opposite), opposite)
  const raised = resolveWallCabinetPlacement(definition, floor, definitions, mount(3, 1.7), {}, { from: mount(3, .4) })
  close(raised?.height, 1.4 - .72)
  const slide = resolveWallCabinetPlacement(definition, floor, definitions, mount(edge + .2, 1.1), {}, { from: mount(edge) })
  close(slide?.wallAttachment.offset, edge)
  close(slide?.height, 1.1)
})

test('an adjoining wall cabinet stops the drag at its front rather than allowing a corner overlap', () => {
  const definition = kitchenUnitDefinition('cabinet', 'Wall cabinet', createKitchenUnitDesign('wall'))
  const definitions = new Map([[definition.id, definition]])
  const wall: Wall = { id: 'wall', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .1, height: 3 }
  const perpendicular: Wall = { ...wall, id: 'adjoining', end: { x: 0, y: 6 } }
  const neighbour = fitWallMountedObject(definition, perpendicular, { wallId: perpendicular.id, offset: .3, side: -1 })!
  const from = fitWallMountedObject(definition, wall, { wallId: wall.id, offset: 2, side: 1 })
  const candidate = fitWallMountedObject(definition, wall, { wallId: wall.id, offset: .35, side: 1 })
  const floor = { walls: [wall, perpendicular], models: [{ id: 'fixed', modelId: definition.id, scale: 1, ...neighbour }] }
  const result = resolveWallCabinetPlacement(definition, floor, definitions, candidate, {}, { from })
  assert.ok(Math.abs(result!.wallAttachment.offset - (.051 + .35 + .3)) < 1e-8)
})

test('wall cabinets stop flush at a return wall and stay clear on the other face of the host', () => {
  const definition = kitchenUnitDefinition('cabinet', 'Wall cabinet', createKitchenUnitDesign('wall'))
  const host: Wall = { id: 'host', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 3 }
  const returned: Wall = { ...host, id: 'return', end: { x: 0, y: 4 }, thickness: .24 }
  const floor = { walls: [host, returned], models: [] }
  const definitions = new Map([[definition.id, definition]])
  const mount = (offset: number, side: 1 | -1 = 1) =>
    fitWallMountedObject(definition, host, { wallId: host.id, offset, side })!
  const from = mount(2)
  const contact = resolveWallCabinetPlacement(definition, floor, definitions, mount(.3), {}, { from })
  assert.ok(Math.abs(contact!.wallAttachment.offset - .42) < 1e-8)
  assert.equal(contact?.height, from.height)
  const snapped = resolveWallCabinetPlacement(definition, floor, definitions, mount(.45), {}, { snap: 'both' })
  assert.ok(Math.abs(snapped!.wallAttachment.offset - .42) < 1e-8)
  assert.equal(snapped?.height, from.height)
  assert.equal(resolveWallCabinetPlacement(definition, floor, definitions, mount(.3)), null)
  assert.deepEqual(resolveWallCabinetPlacement(definition, floor, definitions, mount(.3, -1)), mount(.3, -1))
})

test('wall cabinet drags cannot skip through a partition and can clear a low wall', () => {
  const definition = kitchenUnitDefinition('cabinet', 'Wall cabinet', createKitchenUnitDesign('wall'))
  const host: Wall = { id: 'host', kind: 'external', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .24, height: 3 }
  const partition: Wall = { ...host, id: 'partition', kind: 'internal', start: { x: 3, y: 0 }, end: { x: 3, y: 3 }, thickness: .3 }
  const definitions = new Map([[definition.id, definition]])
  const mount = (offset: number, height = 1.4) =>
    fitWallMountedObject(definition, host, { wallId: host.id, offset, side: 1 }, { height })!
  const full = { walls: [host, partition], models: [] }
  const contact = resolveWallCabinetPlacement(definition, full, definitions, mount(5), {}, { from: mount(1) })
  assert.ok(Math.abs(contact!.wallAttachment.offset - 2.55) < 1e-8)
  const low = { ...full, walls: [host, { ...partition, height: .9 }] }
  assert.deepEqual(resolveWallCabinetPlacement(definition, low, definitions, mount(5), {}, { from: mount(1) }), mount(5))
  const lowered = resolveWallCabinetPlacement(definition, low, definitions, mount(3, .4), {}, { from: mount(3) })
  assert.ok(Math.abs(lowered!.height - .9) < 1e-8)
  assert.equal(lowered!.wallAttachment.offset, 3)
})

test('wall-mounted decor can move to another face while keeping its height and creating no opening', () => {
  const frame: ModelDefinition = { id: 'frame', name: 'Picture frame', category: 'Decoration', color: '#fff',
    shape: 'box', width: .8, height: .6, depth: .03, placement: 'wall-mounted' }
  const first: Wall = { id: 'first', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 2.4 }
  const second: Wall = { ...first, id: 'second', kind: 'external', start: { x: 6, y: 0 }, end: { x: 6, y: 5 } }
  const walls = [first, second]
  const hung = getWallMountedObjectPlacement(frame, walls, { x: 2, y: .15 })
  assert.ok(hung)
  assert.deepEqual(hung.wallAttachment, { wallId: 'first', side: 1, offset: 2 })
  const display = getWallMountedObjectDisplayPoint(first, hung.wallAttachment, -.015)
  assert.ok(Math.abs(display.y - .116) < 1e-9)

  const moved = getWallMountedObjectPlacement(frame, walls, { x: 6.15, y: 3 }, hung)
  assert.ok(moved)
  assert.deepEqual(moved.wallAttachment, { wallId: 'second', side: -1, offset: 3 })
  assert.equal(moved.height, hung.height)
  assert.ok(Math.abs(moved.rotation - Math.PI * 1.5) < 1e-9)
  assert.equal(getWallMountedObjectPlacement(frame, walls, { x: 3, y: 3 }, moved), null)
  const floor: FloorLevel = { id: 'floor', name: 'Floor 0', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    walls, rooms: [], models: [{ id: 'picture', modelId: frame.id, scale: 1, ...moved }] }
  assert.ok(syncWallOpenings(floor, new Map([[frame.id, frame]])).walls.every(wall => !wall.openings?.length))
})

test('existing floor-placed decor can mount on the nearest wall without changing the catalogue default', () => {
  const frame: ModelDefinition = { id: 'frame', name: 'Picture frame', category: 'Decoration', color: '#fff',
    shape: 'box', width: .8, height: .6, depth: .03, objectType: 'decor', placement: 'floor' }
  const wall: Wall = { id: 'wall', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 2.4 }
  const position = { x: 3, y: 2 }
  assert.equal(isWallMountedDecoration(frame, {}), false)
  assert.equal(getWallMountedObjectPlacement(frame, [wall], position), null)
  const mounted = getWallMountedObjectPlacement(frame, [wall], position, {}, Infinity)
  assert.ok(mounted)
  assert.equal(mounted.height, 1.15)
  assert.deepEqual(mounted.wallAttachment, { wallId: 'wall', side: 1, offset: 3 })
  assert.equal(isWallMountedDecoration(frame, mounted), true)
  assert.equal(frame.placement, 'floor')
})

test('dragging the same spot on a frame follows the selected face across walls and respects wall bounds', () => {
  const frame: ModelDefinition = { id: 'frame', name: 'Frame', category: 'Decoration', color: '#fff',
    shape: 'box', width: .8, height: .6, depth: .03, placement: 'wall-mounted' }
  const first: Wall = { id: 'first', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: .2, height: 2.4 }
  const second: Wall = { ...first, id: 'second', start: { x: 6, y: 0 }, end: { x: 6, y: 6 } }
  const floor = { walls: [first, second], elevation: 2.7 }
  const origin = new Vector3(3, 4.2, 2.5)
  const rayTo = (x: number, y: number, z: number) => new Ray(origin, new Vector3(x, y, z).sub(origin).normalize())
  const initial = getWallMountedObjectPlacementAlongRay(rayTo(2, 4.3, .1), floor, frame)
  assert.equal(initial?.wallAttachment.wallId, 'first')
  assert.ok(Math.abs(initial!.height - 1.3) < 1e-9)
  const dragged = getWallMountedObjectPlacementAlongRay(rayTo(5.9, 4.6, 3), floor, frame, initial,
    { alongWall: .2, height: .55 })
  assert.equal(dragged?.wallAttachment.wallId, 'second')
  assert.equal(dragged?.wallAttachment.side, 1)
  assert.ok(Math.abs(dragged!.wallAttachment.offset - 2.8) < 1e-9)
  assert.ok(Math.abs(dragged!.height - 1.35) < 1e-9)
  const high = getWallMountedObjectPlacementAlongRay(rayTo(5.9, 5, 3), floor, frame, dragged,
    { alongWall: 0, height: .1 })
  assert.ok(Math.abs(high!.height - 1.8) < 1e-9)
})

test('ceiling fixtures can mount inside a horizontal room and clear of stair openings', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
  const floor: FloorLevel = { id: 'upper', name: 'Upper', elevation: 3, roomHeight: 2.4, slabThickness: .2,
    walls: [], rooms: [{ id: 'room', name: 'Room', signature: 'room' }], models: [] }
  const detected = [{ id: 'room', signature: 'room', area: 16, polygon }]
  const area = getCeilingMountArea(floor, [floor], detected, new Map())
  assert.equal(ceilingMountFits({ x: 2, y: 2 }, area), true)
  assert.equal(ceilingMountFits({ x: 5, y: 2 }, area), false)
  assert.equal(ceilingMountFits({ x: 2, y: 2 }, { ...area, stairOpenings: [polygon] }), false)
  floor.rooms[0].ceilingMode = 'open'
  assert.equal(ceilingMountFits({ x: 2, y: 2 }, getCeilingMountArea(floor, [floor], detected, new Map())), false)
})

test('inner roof skin permission survives project JSON with bounded depth and defaults off', () => {
  const floor: FloorLevel = { id: 'top', name: 'Top', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    walls: [], rooms: [], models: [], roofs: [{ id: 'roof', type: 'flat', width: 4, depth: 4,
      position: { x: 0, y: 0 }, rotation: 0, pitchDegrees: 0, allowInteriorSkin: true, interiorSkinDepth: .03 }] }
  const saved = JSON.parse(JSON.stringify(floor)) as FloorLevel
  const roof = normalizeFloor(saved, new Map()).roofs[0]
  assert.equal(roof.allowInteriorSkin, true); assert.equal(roof.interiorSkinDepth, .03)
  delete saved.roofs![0].allowInteriorSkin
  assert.equal(normalizeFloor(saved, new Map()).roofs[0].allowInteriorSkin, false)
  for (const [depth, expected] of [[-.1, 0], [2, .1], [.07, .07]]) {
    saved.roofs![0].interiorSkinDepth = depth
    assert.equal(normalizeFloor(saved, new Map()).roofs[0].interiorSkinDepth, expected)
  }
})

test('top-storey ceiling preference survives project JSON and floor normalization', () => {
  const source: FloorLevel = {id:'top',name:'Top',elevation:2.7,roomHeight:2.4,
    slabThickness:0.3,ceilingMode:'open',walls:[],rooms:[
      {id:'room-1',name:'Living room',signature:'room-1',ceilingMode:'horizontal'},
      {id:'room-2',name:'Kitchen',signature:'room-2',ceilingMode:'open'},
    ],models:[]}
  const loaded = normalizeFloor(JSON.parse(JSON.stringify(source)), new Map())
  assert.equal(loaded.ceilingMode, 'open')
  assert.deepEqual(loaded.rooms.map(room => room.ceilingMode), ['horizontal', 'open'])
  assert.equal(loaded.slabThickness, 0.3)
})

const modelsById = new Map<string, ModelDefinition>([
  [
    'dormer-window',
    {
      id: 'dormer-window',
      name: 'Dormer Window',
      category: 'Windows',
      color: '#e5e7eb',
      depth: 1.35,
      height: 1.35,
      roofMount: 'dormer',
      shape: 'box',
      width: 1.25,
    },
  ],
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

test('doors stop at the physical edge of an adjoining wall on either face', () => {
  const host = { ...wall, end: { x: 10, y: 0 } }
  const definition = modelsById.get('panel-interior-door-closed')!
  const halfWidth = definition.openingWidth! / 2
  for (const side of [1, -1]) {
    const branch: Wall = { ...wall, id: 'branch', kind: 'internal', thickness: .2,
      start: { x: 5, y: .15 * side }, end: { x: 5, y: 3 * side } }
    const walls = [host, branch]
    assert.equal(getDoorWallOffset(host, walls, definition, 8, { fromOffset: 2 }), 4.9 - halfWidth)
    assert.equal(getDoorWallOffset(host, walls, definition, 2, { fromOffset: 8 }), 5.1 + halfWidth)
    assert.equal(doorPlacementFits(definition, walls, { wallId: host.id, offset: 5 }), false)
    assert.equal(doorPlacementFits(definition, walls, { wallId: host.id, offset: 8 }), true)

    const nearby = { ...branch, start: { x: 5, y: .3 * side } }
    assert.equal(getDoorWallOffset(host, [host, nearby], definition, 8, { fromOffset: 2 }), 8)
  }
})

test('door placement checks the complete opening including centre offsets and sidelights', () => {
  const host = { ...wall, end: { x: 10, y: 0 } }
  const branch: Wall = { ...wall, id: 'branch', kind: 'internal', thickness: .2,
    start: { x: 5, y: 0 }, end: { x: 5, y: 3 } }
  const walls = [host, branch]
  const definition = { ...modelsById.get('panel-interior-door-closed')!, openingCenterOffset: .2 }
  const model: PlacedModel = { id: 'door', modelId: definition.id, scale: 1, rotation: 0, position: { x: 3, y: 0 },
    wallAttachment: { wallId: host.id, offset: 3, side: -1 } }
  const move = constrainDoorUpdate(model, definition, walls, { position: { x: 8, y: 2 } })
  const stop = 4.9 - (definition.openingWidth! / 2 + .2)
  assert.deepEqual(move?.wallAttachment, { ...model.wallAttachment, offset: stop })
  assert.deepEqual(move?.position, { x: stop, y: 0 })
  assert.equal(constrainDoorUpdate(model, definition, walls, { position: model.position, widthScale: 6 }), null,
    'Widening a door cannot move it into the bay across the junction')
  const patio = modelsById.get('patio-doors-side-lights')!
  assert.equal(getDoorWallOffset(host, walls, patio, 8, { fromOffset: 3 }), 4.9 - patio.width / 2)
})

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

test('new floor objects line up with the 3D view on the chosen storey', () => {
  const cabinet = kitchenUnitDefinition('base', 'Base cabinet', createKitchenUnitDesign('base'))
  const elevation = 2.7
  const camera = new PerspectiveCamera()
  camera.position.set(6, 6.1, 8)
  camera.lookAt(4, elevation + cabinet.height / 2, 3)
  const position = getModelPositionInView(camera, elevation, cabinet)
  assert.ok(Math.abs(position.x - 4) < 1e-8)
  assert.ok(Math.abs(position.y - 3) < 1e-8)
  const model = createPlacedModel({ id: 'cabinet', modelId: cabinet.id, modelsById: new Map([[cabinet.id, cabinet]]), position, walls: [] })
  assert.ok(Math.abs(model.position.y + cabinet.depth / 2 - 3) < 1e-8, 'aligns the cabinet centre while retaining its back pivot')
  assert.equal(model.kitchenUnitOrigin, 'back')
})

test('a level or near-horizontal camera spawns models a short distance ahead', () => {
  const camera = new PerspectiveCamera()
  camera.position.set(4, 1.8, 6)
  for (const lookHeight of [1.79, 1.8, 2]) {
    camera.lookAt(4, lookHeight, 5)
    assert.deepEqual(getModelPositionInView(camera, 0, { width: 1, depth: 1, height: 1 }), { x: 4, y: 3 })
  }
})

test('new dormers start without a window and preserve that choice on load', () => {
  const model = createPlacedModel({
    id: 'dormer-1',
    modelId: 'dormer-window',
    modelsById,
    walls: [wall],
  })
  assert.equal(model.dormerWindowModelId, undefined)
  assert.deepEqual(model.dormerWindowOpenings, [])

  const floor: FloorLevel = {
    id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4,
    slabThickness: 0.2, walls: [], rooms: [], roofs: [],
    models: [{
      ...model,
      dormerWindowModelId: 'window',
      roofAttachment: {
        localPosition: { x: -1, y: 0 },
        roofId: 'roof-1',
        surface: 'negative-x',
      },
    }],
  }
  const [normalized] = normalizeFloor(floor, modelsById).models
  assert.equal(normalized.dormerWindowModelId, 'window')
  assert.deepEqual(normalized.dormerWindowOpenings, [])
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
