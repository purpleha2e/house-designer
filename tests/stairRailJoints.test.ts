import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { createStairHandrail, getStairRailPath } from '../src/stairRailings.ts'
import { stairNewelRailHeight, trimStairRailsAtNewels } from '../src/stairRailJoints.ts'
import { createStairDesign, getStairLayout } from '../src/stairDesign.ts'
import { createStairGeometry, disposeStairGeometry } from '../src/stairGeometry.ts'

test('equal-width rail and newel have no overlapping side faces at the joint', () => {
  const rail = createStairHandrail([{ x: 0, y: 1, z: -1 }, { x: 0, y: 1, z: 1 }], .075)
  const post = new Box3(new Vector3(-.0375, 0, -.0375), new Vector3(.0375, 2, .0375))
  const trimmed = trimStairRailsAtNewels(rail, [post]), material = new MeshStandardMaterial()
  try {
    const mesh = new Mesh(trimmed, material)
    const atJoint = new Raycaster(new Vector3(.2, 1, 0), new Vector3(-1, 0, 0)).intersectObject(mesh)
    const awayFromJoint = new Raycaster(new Vector3(.2, 1, .2), new Vector3(-1, 0, 0)).intersectObject(mesh)
    assert.equal(atJoint.length, 0, 'no wood faces remain coplanar with the painted post sides')
    assert.ok(awayFromJoint.length, 'the rest of the rail remains intact')
    assert.equal(trimmed.getAttribute('uv').count, trimmed.getAttribute('position').count)
    for (const attribute of Object.values(trimmed.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite))
  } finally { rail.dispose(); trimmed.dispose(); material.dispose() }
})

test('a rising rail exits the newel through its side below the cap', () => {
  const path = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 1 }]
  assert.ok(Math.abs(stairNewelRailHeight(path, path[0], .075, .075) - 1.0375) < 1e-8)
})

test('U-turns have two inside newels with a direct rail between them, without a third middle newel', () => {
  for (const turn of ['left', 'right'] as const) for (const landingSteps of [0, 1, 2, 3] as const) {
    const design = { ...createStairDesign(), layout: 'u' as const, turn, landingSteps, riserCount: 14 + landingSteps,
      stepsBeforeTurn: 7, handrailWidth: .075, postWidth: .075 }
    const layout = getStairLayout(design), object = createStairGeometry(design)
    try {
      const positions = (object.getObjectByName('stair-posts') as Mesh).geometry.getAttribute('position')
      const boxes: Box3[] = []
      for (let i = 0; i < positions.count; i += 36) {
        const box = new Box3()
        for (let j = i; j < i + 36; j++) box.expandByPoint(new Vector3().fromBufferAttribute(positions, j))
        boxes.push(box)
      }
      const turnZ = layout.flights[0].left.at(-1)!.z
      assert.equal(boxes.filter(b => Math.abs(b.getCenter(new Vector3()).z - turnZ) < 1e-6).length, 2)
      const path = getStairRailPath(design, layout, turn === 'right' ? 'right' : 'left')
      assert.equal(new Set(path.filter(p => Math.abs(p.z - turnZ) < 1e-7).map(p => p.x.toFixed(6))).size, 2)
      const ends = path.filter(p => Math.abs(p.z - turnZ) < 1e-7), xs = ends.map(p => p.x)
      const x = (Math.min(...xs) + Math.max(...xs)) / 2
      const hits = new Raycaster(new Vector3(x, 10, turnZ), new Vector3(0, -1, 0))
        .intersectObject(object.getObjectByName('stair-spindles')!)
      assert.ok(hits.length, 'the short return has a spindle between its two newels')
    } finally { disposeStairGeometry(object) }
  }
})
