import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, CapsuleGeometry, Mesh, MeshPhysicalMaterial, Raycaster, Vector3 } from 'three'
import { copyKitchenUnitStyle, createKitchenUnitDesign, getKitchenHandleFinish, getKitchenUnitLayouts, getKitchenUnitSize,
  kitchenUnitDefinition, validateKitchenUnitDesign } from '../src/kitchenUnitDesign.ts'
import { createKitchenUnitGeometry } from '../src/kitchenUnitGeometry.ts'
import { getModelLibraryRoot } from '../src/models/modelLibrarySections.ts'
import { createPlacedModel, fitWallMountedObject, normalizeFloor, syncWallOpenings } from '../src/modelPlacement.ts'
import { getModelTransformBounds, updateModelTransformField } from '../src/modelTransformFields.ts'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'

test('a base unit fits its specified dimensions and worktop overhang', () => {
  const design = { ...createKitchenUnitDesign(), width: .9, height: .92, sideOverhang: .01,
    plinthHeight: .13, handleStyle: 'none' as const, worktopMaterialId: 'stone' }
  const definition = kitchenUnitDefinition('custom-kitchen-unit-1', 'Shaker base', design)
  const group = createKitchenUnitGeometry(design)
  const size = getKitchenUnitSize(design)
  assert.equal(getModelLibraryRoot(definition), 'mine')
  assert.equal(definition.kitchenUnitDesign?.worktopMaterialId, 'stone')
  const bounds = new Box3().setFromObject(group)
  assert.ok(bounds.getSize(new Vector3()).distanceTo(new Vector3(size.width, size.height, size.depth)) < 1e-7)
  assert.ok(bounds.min.distanceTo(new Vector3(-size.width / 2, 0, 0)) < 1e-7)
  assert.equal(definition.localBounds?.minZ, 0)
  const plinth = group.getObjectByName('plinth')
  assert.ok(plinth)
  assert.equal(plinth.position.y, .065)
  const plinthBounds = new Box3().setFromObject(plinth)
  assert.ok(Math.abs(plinthBounds.max.x - design.width / 2) < 1e-7)
  assert.ok(Math.abs(plinthBounds.min.x + design.width / 2) < 1e-7)
  assert.ok(Math.abs(plinthBounds.max.z - (design.depth - design.plinthInset)) < 1e-7)
  const top = group.getObjectByName('worktop')
  assert.ok(top instanceof Mesh)
  assert.equal(top.material.name, 'hd_worktop')
  assert.ok(validateKitchenUnitDesign({ ...design, height: .45, plinthHeight: .3 }))
})

test('wall units have their own cabinet dimensions and their mounting height is set per instance', () => {
  const design = { ...createKitchenUnitDesign('wall'), width: .8, depth: .2, sideOverhang: .05 }
  const definition = kitchenUnitDefinition('wall-cabinet', 'Shaker wall unit', design)
  assert.equal(definition.placement, 'wall-mounted')
  assert.deepEqual(getKitchenUnitSize(design), { width: .8, depth: .2, height: .72 })
  assert.deepEqual(definition.materialRegions?.map(region => region.id), ['hd_cabinet', 'hd_fronts', 'hd_handles'])
  const cabinet = createKitchenUnitGeometry(design)
  assert.equal(cabinet.getObjectByName('plinth'), undefined)
  assert.equal(cabinet.getObjectByName('worktop'), undefined)
  assert.ok(Math.abs(new Box3().setFromObject(cabinet).min.y) < 1e-7)
  assert.ok((cabinet.getObjectByName('handle-bar')?.position.y ?? Infinity) < design.height / 2)

  const wall: Wall = { id: 'wall', kind: 'external', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: .15, height: 2.5 }
  const attachment = { wallId: wall.id, offset: 2, side: 1 as const }
  const mount = fitWallMountedObject(definition, wall, attachment)
  assert.equal(mount?.height, 1.4)
  assert.equal(fitWallMountedObject(definition, wall, attachment, { height: 1.2 })?.height, 1.2)
  assert.equal(fitWallMountedObject(definition, wall, attachment, { height: 2 })?.height, wall.height - design.height)
  assert.ok(mount)
  const model = { ...createPlacedModel({ id: 'cabinet', modelId: definition.id,
    modelsById: new Map([[definition.id, definition]]), walls: [wall] }), ...mount }
  assert.equal(model.kitchenUnitOrigin, 'back')
  const floor: FloorLevel = { id: 'floor', name: 'Floor 0', walls: [wall], rooms: [], roofs: [], models: [model],
    elevation: 0, roomHeight: 2.5, slabThickness: .2 }
  assert.deepEqual(syncWallOpenings(floor, new Map([[definition.id, definition]])).walls[0].openings ?? [], [])
})

test('older kitchen units move their saved pivot once while retaining rotated and flipped geometry', () => {
  const design = createKitchenUnitDesign()
  const definition = kitchenUnitDefinition('unit', 'Base unit', design)
  const modelsById = new Map([[definition.id, definition]])
  const legacy: PlacedModel = { id: 'old-unit', modelId: 'unit', position: { x: 4, y: 3 },
    rotation: Math.PI / 3, scale: 1.25, depthScale: .8, flipped: true, mirrored: true }
  const floor: FloorLevel = { id: 'floor', name: 'Floor 0', walls: [], rooms: [], roofs: [], models: [legacy],
    elevation: 0, roomHeight: 2.4, slabThickness: .2 }
  const loaded = normalizeFloor(floor, modelsById)
  const unit = loaded.models[0]
  assert.equal(unit.kitchenUnitOrigin, 'back')
  const centre = new Vector3(0, 0, -definition.depth * legacy.scale * legacy.depthScale! / 2)
    .applyAxisAngle(new Vector3(0, 1, 0), -legacy.rotation)
    .add(new Vector3(unit.position.x, 0, unit.position.y))
  assert.ok(centre.distanceTo(new Vector3(legacy.position.x, 0, legacy.position.y)) < 1e-9)
  assert.deepEqual(normalizeFloor(JSON.parse(JSON.stringify(loaded)), modelsById).models[0].position, unit.position)
  const bounds = getModelTransformBounds(definition)
  assert.equal(bounds.minZ, 0)
  assert.deepEqual(updateModelTransformField(unit, bounds, 'rotation', 90).position, unit.position)
  assert.deepEqual(updateModelTransformField(unit, bounds, 'length', .8).position, unit.position)
  assert.equal(createPlacedModel({ id: 'new-unit', modelId: 'unit', modelsById, walls: [] }).kitchenUnitOrigin, 'back')
})

test('handle finishes are applied to the hardware and old kitchen designs default to bronze', () => {
  const design = { ...createKitchenUnitDesign(), handleStyle: 'knob' as const, handleFinish: 'brushed-silver' as const }
  const knob = createKitchenUnitGeometry(design).getObjectByName('knob')
  assert.ok(knob instanceof Mesh && knob.material instanceof MeshPhysicalMaterial)
  assert.equal(knob.material.name, 'hd_handles')
  assert.equal(knob.material.color.getHexString(), 'bdc3c8')
  assert.equal(knob.material.anisotropy, .55)
  assert.ok(knob.material.roughness > getKitchenHandleFinish({ ...design, handleFinish: 'silver' }).roughness)
  assert.equal(getKitchenHandleFinish({ ...design, handleFinish: undefined }).label, 'Bronze')
})

test('rounded bar handles have rounded geometry, matching finishes and the correct axis for each front', () => {
  const design = { ...createKitchenUnitDesign(), layout: 'drawer-and-doors' as const,
    handleStyle: 'rounded-bar' as const, handleFinish: 'black' as const }
  assert.equal(validateKitchenUnitDesign(design), null)
  const group = createKitchenUnitGeometry(design)
  const bars = group.children.filter(child => child.name === 'handle-bar')
  assert.equal(bars.length, 3)
  assert.ok(bars.every(bar => bar instanceof Mesh && bar.geometry instanceof CapsuleGeometry &&
    bar.material instanceof MeshPhysicalMaterial && bar.material.color.getHexString() === '252629'))
  assert.deepEqual(bars.map(bar => bar.rotation.z), [0, 0, Math.PI / 2])
})

test('the worktop rolls only along its upper front edge using the specified radius', () => {
  const design = { ...createKitchenUnitDesign(), frontRollRadius: .012 }
  const size = getKitchenUnitSize(design)
  const rolled = createKitchenUnitGeometry(design)
  const plain = createKitchenUnitGeometry(createKitchenUnitDesign())
  rolled.updateMatrixWorld(true)
  plain.updateMatrixWorld(true)
  const worktop = rolled.getObjectByName('worktop')
  const squareTop = plain.getObjectByName('worktop')
  assert.ok(worktop instanceof Mesh && squareTop instanceof Mesh)
  assert.equal(worktop.material.name, 'hd_worktop')
  const bounds = new Box3().setFromObject(worktop)
  assert.ok(bounds.getSize(new Vector3()).distanceTo(new Vector3(size.width, design.worktopThickness, size.depth)) < 1e-7)
  const rayDown = (z: number, slab: Mesh) => new Raycaster(new Vector3(0, size.height + 1, z), new Vector3(0, -1, 0))
    .intersectObject(slab)[0]
  const z = size.depth - .006
  const hit = rayDown(z, worktop)
  const expected = size.height - .012 + Math.sqrt(.012 ** 2 - (.012 - .006) ** 2)
  assert.ok(Math.abs(hit.point.y - expected) < .00002)
  assert.ok(hit.uv && Number.isFinite(hit.uv.x) && Number.isFinite(hit.uv.y))
  assert.ok(Math.abs(rayDown(z, squareTop).point.y - size.height) < 1e-7)
  assert.ok(Math.abs(rayDown(.006, worktop).point.y - size.height) < 1e-7)
  assert.equal(validateKitchenUnitDesign({ ...design, frontRollRadius: design.worktopThickness }), null)
  assert.ok(validateKitchenUnitDesign({ ...design, frontRollRadius: design.worktopThickness + .001 }))
  assert.equal(validateKitchenUnitDesign({ ...design, worktopThickness: 0 }), null)
})

test('square and rounded worktops keep the top texture scale on their exposed edges', () => {
  for (const radius of [0, .018]) {
    const design = { ...createKitchenUnitDesign(), width: 1.2, worktopThickness: .036, frontRollRadius: radius }
    const size = getKitchenUnitSize(design)
    const group = createKitchenUnitGeometry(design)
    group.updateMatrixWorld(true)
    const slab = group.getObjectByName('worktop')!
    const sample = (x: number, y: number, z: number, direction: Vector3) => {
      const hit = new Raycaster(new Vector3(x, y, z), direction).intersectObject(slab)[0]
      assert.ok(hit?.uv)
      return hit.uv
    }
    const drop = .027
    const z = .25
    const expectedV = 1 - z / size.depth
    const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6)
    for (const side of [-1, 1]) {
      const top = sample(side * (size.width / 2 - drop), size.height + 1, z, new Vector3(0, -1, 0))
      const edge = sample(side * (size.width / 2 + 1), size.height - drop, z, new Vector3(-side, 0, 0))
      const seamU = side === 1 ? 1 : 0
      close(top.x, seamU - side * drop / size.width)
      close(edge.x, seamU + side * drop / size.width)
      close(top.y, expectedV)
      close(edge.y, expectedV)
    }
    const front = sample(0, size.height - drop, size.depth + 1, new Vector3(0, 0, -1))
    close(front.x, .5)
    close(front.y, -(radius * Math.PI / 2 + drop - 2 * radius) / size.depth)
  }
})

test('copying kitchen styles keeps cabinet dimensions and applies trim only between base units', () => {
  const base = { ...createKitchenUnitDesign(), width: 1.2, depth: .65, height: .96 }
  const source = { ...createKitchenUnitDesign(), layout: 'three-drawers' as const, doorStyle: 'raised-panel' as const,
    handleStyle: 'rounded-bar' as const, handleFinish: 'brushed-gold' as const, frontColor: '#003300', cabinetColor: '#ccddcc',
    plinthColor: '#443322', plinthHeight: .12, plinthInset: .07, worktopThickness: .04,
    frontRollRadius: .02, frontOverhang: .03, sideOverhang: .01, worktopMaterialId: 'granite' }
  assert.deepEqual(copyKitchenUnitStyle(base, source), { ...source, width: base.width, depth: base.depth, height: base.height })

  const wall = createKitchenUnitDesign('wall')
  assert.deepEqual(copyKitchenUnitStyle(wall, source), { ...wall, doorStyle: source.doorStyle,
    handleStyle: source.handleStyle, handleFinish: source.handleFinish, frontColor: source.frontColor, cabinetColor: source.cabinetColor })
  assert.deepEqual(copyKitchenUnitStyle(source, wall), { ...source, layout: wall.layout, doorStyle: wall.doorStyle,
    handleStyle: wall.handleStyle, handleFinish: wall.handleFinish, frontColor: wall.frontColor, cabinetColor: wall.cabinetColor })
})

test('the glass wall unit has a transparent framed door and two shelves inside a hollow cabinet', () => {
  const design = { ...createKitchenUnitDesign('wall'), layout: 'glass-front' as const }
  assert.deepEqual(getKitchenUnitLayouts('wall'), ['single-door', 'double-door', 'glass-front'])
  assert.deepEqual(getKitchenUnitLayouts('base'), ['single-door', 'double-door', 'drawer-and-doors', 'three-drawers'])
  assert.equal(validateKitchenUnitDesign(design), null)
  assert.ok(validateKitchenUnitDesign({ ...design, unitType: 'base' }))
  assert.equal(validateKitchenUnitDesign({ ...design, layout: 'three-drawers' }), null)
  const cabinet = createKitchenUnitGeometry(design)
  cabinet.updateMatrixWorld(true)
  const pane = cabinet.getObjectByName('glass-pane')
  assert.ok(pane instanceof Mesh && pane.material.transparent && pane.material.opacity < 1)
  const shelves = cabinet.children.filter(child => child.name === 'shelf')
  assert.equal(shelves.length, 2)
  assert.ok(shelves[0].position.y < design.height / 2 && shelves[1].position.y > design.height / 2)
  const ray = new Raycaster(new Vector3(0, design.height / 2, 1), new Vector3(0, 0, -1))
  assert.deepEqual([...new Set(ray.intersectObject(cabinet, true).map(hit => hit.object.name))], ['glass-pane', 'cabinet-back'])
})

test('front profiles differ and worktop, plinth and handles can be omitted', () => {
  const design = { ...createKitchenUnitDesign(), layout: 'three-drawers' as const, plinthHeight: 0,
    worktopThickness: 0, handleStyle: 'none' as const }
  const firstHit = (doorStyle: typeof design.doorStyle) => {
    const group = createKitchenUnitGeometry({ ...design, doorStyle })
    group.updateMatrixWorld()
    const ray = new Raycaster(new Vector3(0, .15, 1), new Vector3(0, 0, -1))
    return ray.intersectObject(group, true)[0]
  }
  assert.equal(firstHit('slab').object.name, 'slab-front')
  assert.equal(firstHit('shaker').object.name, 'recessed-panel')
  assert.equal(firstHit('raised-panel').object.name, 'raised-panel')
  assert.ok(firstHit('shaker').distance > firstHit('raised-panel').distance)
  assert.deepEqual(kitchenUnitDefinition('unit', 'Handleless drawers', design).materialRegions?.map(region => region.id),
    ['hd_cabinet', 'hd_fronts'])
})
