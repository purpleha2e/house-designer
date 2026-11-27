import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Mesh, Raycaster, Vector3, type MeshStandardMaterial } from 'three'
import { createDoorDesign, DEFAULT_DOOR_GROOVE_COLOR, DOOR_CASING_WIDTH, doorDefinition, doorFrameProfiles, doorPresetPanels, doorStyles, getDoorMaterialIds,
  getDoorOpeningSize, getDoorPanelTextureValue, normalizeDoorAngles, spaceDoorPanels, validateDoorDesign, type DoorDesign,
  type DoorFrameProfile } from '../src/doorDesign.ts'
import { createDoorGeometry, setDoorLeafAngles } from '../src/doorGeometry.ts'
import { doorPlacementFits, normalizeFloor } from '../src/modelPlacement.ts'
import { getModelLibraryRoot } from '../src/models/modelLibrarySections.ts'
import type { FloorLevel } from '../src/types.ts'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6)

test('oak door presets validate across the supplied leaf widths', () => {
  const initial = createDoorDesign()
  assert.equal(initial.height, 1.981)
  for (const style of Object.keys(doorStyles) as (keyof typeof doorStyles)[]) {
    const panels = doorPresetPanels(style)
    assert.equal(panels.length, style === 'raised' ? 4 : 5)
    for (const width of [.610, .686, .762, .838]) {
      assert.equal(validateDoorDesign({ ...initial, width, style, panels }), null)
    }
  }
  const first = initial.panels[0]
  assert.ok(validateDoorDesign({ ...initial, panels: [first, { ...first }] }))
  assert.ok(validateDoorDesign({ ...initial, panels: [{ ...first, left: -.05 }] }))
  assert.equal(validateDoorDesign({ ...initial, panels: [{ left: .15, bottom: .17, width: .3, height: .4 }] }), null)
})

test('the frame projects the configured distance from both wall faces even when depth is scaled', () => {
  const design = { ...createDoorDesign(), style: 'raised' as const, panels: doorPresetPanels('raised') }
  for (const frameProfile of Object.keys(doorFrameProfiles) as DoorFrameProfile[]) {
    for (const wallThickness of [.1, .15]) for (const scale of [1, 1.3]) {
      const door = createDoorGeometry({ ...design, frameProfile }, wallThickness, scale)
      door.scale.z = scale
      door.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(door.getObjectByName('door-frame')!)
      near(bounds.min.z, -wallThickness / 2 - .015)
      near(bounds.max.z, wallThickness / 2 + .015)
    }
  }
})

test('door casing relief follows the jambs and head and leaves a stop just behind the closed leaf', () => {
  for (const wallThickness of [.1, .15]) for (const swing of ['front', 'back'] as const) {
    const face = swing === 'front' ? 1 : -1
    const relief: number[][] = []
    for (const frameProfile of Object.keys(doorFrameProfiles) as DoorFrameProfile[]) {
      const design = { ...createDoorDesign(), swing, frameProfile }
      const opening = getDoorOpeningSize(design)
      const door = createDoorGeometry(design, wallThickness)
      door.updateMatrixWorld(true)
      const frame = door.getObjectByName('door-frame')!
      const surface = (x: number, y: number) => new Raycaster(new Vector3(x, y, face), new Vector3(0, 0, -face))
        .intersectObject(frame)[0].point.z
      const stopOffset = -design.jambWidth - .005
      near(surface(opening.width / 2 + stopOffset, .8), -face * (design.thickness / 2 + .00035))
      near(surface(0, opening.height + stopOffset), -face * (design.thickness / 2 + .00035))
      relief.push(Array.from({ length: 24 }, (_, i) => {
        const offset = -design.jambWidth + .0001 + (DOOR_CASING_WIDTH + design.jambWidth) * i / 24
        const depth = surface(opening.width / 2 + offset, .8)
        near(surface(-opening.width / 2 - offset, .8), depth)
        near(surface(0, opening.height + offset), depth)
        return Math.round(depth * face * 10000)
      }))
      const nearLeaf = surface(opening.width / 2 - design.jambWidth + .0001, .8) * face
      assert.ok(Math.abs(nearLeaf - design.thickness / 2) < .002, 'trim reaches the leaf face at its inner edge')
      assert.ok(surface(opening.width / 2 + .0001, .8) * face > wallThickness / 2, 'trim covers the edge of the wall')
      const jamb = new Raycaster(new Vector3(0, .8, 0), new Vector3(1, 0, 0)).intersectObject(frame)[0].point.x
      const leaf = door.getObjectByName('door-leaf-0')!.getObjectByName('door-leaf-woodwork')!
      near(jamb - new Box3().setFromObject(leaf).max.x, .003)
    }
    assert.equal(new Set(relief[0]).size, 4)
    assert.ok(new Set(relief[1]).size > 4)
    assert.notDeepEqual(relief[2], relief[1])
  }
})

test('adding and removing panels reflows the existing area and retains per-panel texture settings', () => {
  const initial = { ...createDoorDesign(), width: .610 }
  for (const style of Object.keys(doorStyles) as (keyof typeof doorStyles)[]) {
    const panels = doorPresetPanels(style)
    const first = { ...panels[0], textureScale: 1.7, textureRotation: 90 }
    const design = { ...initial, style, panels: [first, ...panels.slice(1)] }
    const added = spaceDoorPanels(design, [...design.panels, panels[0]])
    const removed = spaceDoorPanels({ ...design, panels: added }, added.filter((_, index) => index !== 1))
    for (const layout of [added, removed, spaceDoorPanels(design, Array.from({ length: 16 }, () => first))]) {
      assert.equal(validateDoorDesign({ ...design, panels: layout }), null)
      near(Math.min(...layout.map(panel => panel.left)), first.left)
      near(Math.max(...layout.map(panel => panel.left + panel.width)), Math.max(...panels.map(panel => panel.left + panel.width)))
      near(layout[0].textureScale!, 1.7)
      near(layout[0].textureRotation!, 90)
    }
    assert.equal(removed.length, panels.length)
  }
})

test('panel UVs can rotate and repeat independently of the next panel', () => {
  const design = createDoorDesign()
  const sample = (panelIndex: number, textureScale: number, textureRotation: number) => {
    const panels = design.panels.map((panel, index) => index === 0 ? { ...panel, textureScale, textureRotation } : panel)
    const door = createDoorGeometry({ ...design, panels })
    door.updateMatrixWorld(true)
    const leaf = door.getObjectByName('door-leaf-0')!
    const wood = leaf.getObjectByName('door-leaf-woodwork')!
    const panel = panels[panelIndex]
    const x = leaf.position.x + (panel.left + panel.width / 2) * design.width
    const y = leaf.position.y + (panel.bottom + panel.height / 2) * design.height
    const uv = (offset: number) => new Raycaster(new Vector3(x + offset, y, 1), new Vector3(0, 0, -1)).intersectObject(wood)[0].uv!
    return uv(.01).clone().sub(uv(0))
  }
  near(sample(0, 1, 0).x, .01 / .43)
  const rotated = sample(0, 2, 90)
  near(rotated.x, 0)
  near(Math.abs(rotated.y), .01 / 3.6)
  assert.deepEqual(sample(1, 2, 90), sample(1, 1, 0))
})

test('leaf and shared panel textures have independent UV controls and preserve unset legacy values', () => {
  const initial = createDoorDesign()
  const panels = initial.panels.map((panel, index) => index === 0 ? { ...panel, textureScale: 1.5, textureRotation: 25 } : panel)
  const legacy = { ...initial, panels }
  const design = { ...legacy, leafTexture: { textureScale: 2, textureRotation: 90 }, panelTexture: { textureScale: 3, textureRotation: 180 } }
  assert.equal(getDoorPanelTextureValue(legacy, 'textureRotation'), undefined)
  assert.equal(getDoorPanelTextureValue({ ...design, panelTexture: { textureScale: 3 } }, 'textureRotation'), undefined)
  assert.equal(getDoorPanelTextureValue(design, 'textureRotation'), 180)
  assert.equal(getDoorPanelTextureValue(design, 'textureScale'), 3)
  assert.equal(validateDoorDesign(design), null)
  assert.ok(validateDoorDesign({ ...design, leafTexture: { textureScale: 0 } }))

  const uvStep = (doorDesign: DoorDesign, localX: number) => {
    const door = createDoorGeometry(doorDesign)
    door.updateMatrixWorld(true)
    const leaf = door.getObjectByName('door-leaf-0')!
    const wood = leaf.getObjectByName('door-leaf-woodwork')!
    const uv = (offset: number) => new Raycaster(new Vector3(leaf.position.x + localX + offset, .75, 1), new Vector3(0, 0, -1))
      .intersectObject(wood)[0].uv!
    return uv(.01).clone().sub(uv(0))
  }
  near(uvStep(initial, .04).x, .01 / .43)
  const leaf = uvStep(design, .04)
  near(leaf.x, 0)
  near(Math.abs(leaf.y), .01 / 3.6)
  for (const panel of panels) {
    const sample = uvStep(design, (panel.left + panel.width / 2) * design.width)
    near(sample.x, -.01 / (.43 * 3))
    near(sample.y, 0)
  }
})

test('the frame has an independent finish and closed door leaves sit centrally through its depth', () => {
  const design = { ...createDoorDesign(), leafCount: 2 as const, oakMaterialId: 'leaf-finish' }
  assert.equal(getDoorMaterialIds(design).hd_frame, 'leaf-finish')
  assert.equal(getDoorMaterialIds(design, { hd_oak: 'instance-oak' }).hd_frame, 'instance-oak')
  assert.equal(getDoorMaterialIds({ ...design, frameMaterialId: 'frame-finish' }).hd_frame, 'frame-finish')
  assert.equal(getDoorMaterialIds({ ...design, frameMaterialId: null }).hd_frame, undefined)
  for (const wall of [.1, .15]) {
    const door = createDoorGeometry(design, wall)
    door.updateMatrixWorld(true)
    const frame = door.getObjectByName('door-frame') as Mesh
    assert.ok(!Array.isArray(frame.material))
    assert.equal(frame.material.name, 'hd_frame')
    for (const leafIndex of [0, 1]) {
      const leaf = door.getObjectByName(`door-leaf-${leafIndex}`)!
      const box = new Box3().setFromObject(leaf.getObjectByName('door-leaf-woodwork')!)
      near(box.min.z, -design.thickness / 2)
      near(box.max.z, design.thickness / 2)
    }
  }
})

test('plank grooves surround each plank in both directions and on both faces of each leaf', () => {
  const initial = createDoorDesign()
  const originalGrooves = createDoorGeometry(initial).getObjectByName('door-plank-grooves') as Mesh
  assert.equal((originalGrooves.material as MeshStandardMaterial).color.getHexString(), DEFAULT_DOOR_GROOVE_COLOR.slice(1))
  const definition = doorDefinition('grooved', 'Grooved door', { ...initial, leafCount: 2, grooveColor: '#403121' })
  const design: DoorDesign = JSON.parse(JSON.stringify(definition.doorDesign))
  assert.equal(validateDoorDesign(design), null)
  assert.ok(validateDoorDesign({ ...design, grooveColor: 'bad' }))
  for (const style of ['vertical', 'horizontal'] as const) {
    const panels = doorPresetPanels(style)
    const door = createDoorGeometry({ ...design, style, panels })
    door.updateMatrixWorld(true)
    for (const leafIndex of [0, 1]) {
      const leaf = door.getObjectByName(`door-leaf-${leafIndex}`)!
      const grooves = leaf.getObjectByName('door-plank-grooves') as Mesh
      const faces = [leaf.getObjectByName('door-leaf-woodwork')!, grooves]
      assert.equal((grooves.material as MeshStandardMaterial).color.getHexString(), '403121')
      const xMin = leaf.position.x - leafIndex * design.width
      const [first, second] = panels
      const joinX = style === 'vertical' ? (first.left + first.width + second.left) / 2 : first.left + first.width / 2
      const joinY = style === 'horizontal' ? (first.bottom + first.height + second.bottom) / 2 : first.bottom + first.height / 2
      for (const side of [-1, 1]) {
        const hit = (x: number, y: number) => new Raycaster(new Vector3(xMin + x * design.width, leaf.position.y + y * design.height, side),
          new Vector3(0, 0, -side)).intersectObjects(faces)[0]
        assert.equal(hit(joinX, joinY).object, grooves)
        assert.equal(hit(.005, .005).object.name, 'door-leaf-woodwork')
        const last = panels[panels.length - 1]
        const spacing = style === 'vertical' ? (second.left - first.left - first.width) * design.width :
          (second.bottom - first.bottom - first.height) * design.height
        const grooveWidth = .004 + spacing
        const centreX = first.left + first.width / 2
        const centreY = first.bottom + first.height / 2
        const border = (distance: number) => {
          const outer = distance - .002
          const x = outer / design.width, y = outer / design.height
          return [hit(first.left - x, centreY), hit(last.left + last.width + x, centreY),
            hit(centreX, first.bottom - y), hit(centreX, last.bottom + last.height + y)]
        }
        assert.ok(border(grooveWidth - .0002).every(edge => edge.object === grooves))
        assert.ok(border(grooveWidth + .0002).every(edge => edge.object.name === 'door-leaf-woodwork'))
        for (const { left, bottom, width, height } of panels) {
          const centreX = left + width / 2
          const centreY = bottom + height / 2
          const dx = .001 / design.width
          const dy = .001 / design.height
          const plank = hit(centreX, centreY)
          assert.equal(plank.object.name, 'door-leaf-woodwork')
          const edges = [hit(left + dx, centreY), hit(left + width - dx, centreY), hit(centreX, bottom + dy), hit(centreX, bottom + height - dy)]
          for (const edge of edges) {
            assert.equal(edge.object, grooves)
            near((plank.point.z - edge.point.z) * side, .001)
          }
        }
      }
    }
  }
  assert.equal(createDoorGeometry({ ...design, style: 'raised', panels: doorPresetPanels('raised') }).getObjectByName('door-plank-grooves'), undefined)
})

test('the detailed raised panel has stepped, recessed moulding around a raised centre', () => {
  const initial = { ...createDoorDesign(), style: 'raised' as const, panels: doorPresetPanels('raised') }
  const detailed = doorDefinition('detailed', 'Detailed raised', { ...initial, panelDetail: 'detailed' }).doorDesign!
  assert.equal(JSON.parse(JSON.stringify(detailed)).panelDetail, 'detailed')
  const sections = (design: DoorDesign, face: number) => {
    const door = createDoorGeometry(design)
    door.updateMatrixWorld(true)
    const leaf = door.getObjectByName('door-leaf-0')!
    const wood = leaf.getObjectByName('door-leaf-woodwork')!
    const panel = design.panels[0]
    const x = leaf.position.x + (panel.left + panel.width / 2) * design.width
    const y = leaf.position.y + panel.bottom * design.height
    const offsets = [.003, .009, .016, .026, .028, .042, .065, .08]
    return offsets.map(offset => new Raycaster(new Vector3(x, y + offset, face), new Vector3(0, 0, -face))
      .intersectObject(wood)[0].point.z * face)
  }
  assert.deepEqual(sections(initial, 1), sections({ ...initial, panelDetail: 'simple' }, 1))
  const front = sections(detailed, 1)
  sections(detailed, -1).forEach((depth, i) => near(depth, front[i]))
  assert.ok(front[0] > front[1] && front[1] > front[2])
  near(front[3], front[4])
  assert.ok(front[3] + .01 < front[6])
  near(front[6], front[7])
})

test('adjustable handles sit at the saved height from the floor on both sides of each leaf', () => {
  const initial = createDoorDesign()
  assert.ok(validateDoorDesign({ ...initial, handleHeight: initial.height }))
  const design = doorDefinition('handle', 'Handle height', { ...initial, leafCount: 2, handleHeight: 1.087 }).doorDesign!
  const door = createDoorGeometry(JSON.parse(JSON.stringify(design)))
  setDoorLeafAngles(door, design, [90, 37])
  door.updateMatrixWorld(true)
  for (let i = 0; i < 2; i++) {
    const leaf = door.getObjectByName(`door-leaf-${i}`)!
    const hardware = leaf.children.filter(part => part.userData.doorHandleLeaf === i)
    assert.equal(hardware.length, 6)
    for (const part of hardware) near(part.getWorldPosition(new Vector3()).y, 1.087)
  }
  const olderDoor = createDoorGeometry({ ...initial, handleHeight: undefined })
  near(olderDoor.getObjectByName('door-handle')!.position.y, 1)
})

test('each double-door leaf turns independently around its hinge', () => {
  const design = { ...createDoorDesign(), leafCount: 2 as const }
  const door = createDoorGeometry(design)
  const left = door.getObjectByName('door-leaf-0')!, right = door.getObjectByName('door-leaf-1')!
  const hinge = left.position.clone()
  setDoorLeafAngles(door, design, [90, 35])
  door.updateMatrixWorld(true)
  assert.deepEqual(left.position, hinge)
  near(left.rotation.y, -Math.PI / 2)
  near(right.rotation.y, 35 * Math.PI / 180)
  const wood = left.getObjectByName('door-leaf-woodwork')!
  const bounds = new Box3().setFromObject(wood).getSize(new Vector3())
  near(bounds.z, design.width)
  assert.deepEqual(normalizeDoorAngles([220, null]), [110, 0])
})

test('placed doors rebuild the authored opening and retain both leaf poses through loading', () => {
  const design = { ...createDoorDesign(), width: .686, leafCount: 2 as const }
  const definition = doorDefinition('custom-door-1', 'Oak double', design)
  const floor: FloorLevel = { id: 'floor', name: 'Floor 0', elevation: 0, roomHeight: 2.4, slabThickness: .2, rooms: [], roofs: [],
    walls: [{ id: 'wall', kind: 'internal', thickness: .15, height: 2.4, start: { x: 0, y: 0 }, end: { x: 6, y: 0 } }],
    models: [{ id: 'door', modelId: definition.id, scale: 1, position: { x: 3, y: 0 }, rotation: 0,
      wallAttachment: { wallId: 'wall', offset: 3, side: 1 }, doorLeafAngles: [90, 31] }],
  }
  const restored = normalizeFloor(JSON.parse(JSON.stringify(floor)), new Map([[definition.id, definition]]))
  const opening = restored.walls[0].openings?.[0]
  assert.equal(getModelLibraryRoot(definition), 'mine')
  near(opening!.width, getDoorOpeningSize(design).width)
  near(opening!.height, getDoorOpeningSize(design).height)
  assert.deepEqual(restored.models[0].doorLeafAngles, [90, 31])
  assert.equal(doorPlacementFits(definition, [{ ...floor.walls[0], height: 1.9 }], floor.models[0].wallAttachment), false)
})
