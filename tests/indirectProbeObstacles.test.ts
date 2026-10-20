import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createIndirectProbeObstacles } from '../src/indirectProbeObstacles.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { createStairDesign, getStairLayout } from '../src/stairDesign.ts'
import { createStairGeometry, disposeStairGeometry } from '../src/stairGeometry.ts'

test('stair air stays usable while thin treads, posts and surface clearance remain excluded', () => {
  for (const layout of ['straight', 'l', 'u'] as const) for (const mirror of [1, -1]) {
    const design = { ...createStairDesign(), layout }, stairs = createStairGeometry(design)
    stairs.scale.x = mirror
    const box = new Box3().setFromObject(stairs), visibility = createIndirectVisibility(stairs)
    const query = createIndirectProbeObstacles([{ min: box.min.toArray(), max: box.max.toArray(), geometry: true }], visibility)
    try {
      const tread = getStairLayout(design).surfaces[1]
      const centre = tread.polygon.reduce((p, v) => p.add(new Vector3(v.x, 0, v.z)), new Vector3()).multiplyScalar(1 / tread.polygon.length)
      centre.x *= mirror
      centre.y = tread.top + .5
      assert.ok(box.containsPoint(centre), 'test sample is inside the broad stair bounds')
      assert.equal(query.contains(centre), false, `${layout}: air above the tread is usable`)
      centre.y = tread.top - design.treadThickness / 2
      assert.equal(query.contains(centre), true, `${layout}: inside a thin tread is blocked`)
      centre.y = tread.top + .04
      assert.equal(query.contains(centre), true, `${layout}: retain clearance from the tread`)
      const posts = (stairs.getObjectByName('stair-posts') as Mesh).geometry.getAttribute('position')
      const post = new Box3()
      for (let i = 0; i < 36; i++) post.expandByPoint(new Vector3().fromBufferAttribute(posts, i))
      const postCentre = post.getCenter(new Vector3()); postCentre.x *= mirror
      assert.equal(query.contains(postCentre), true, `${layout}: inside a newel is blocked`)
    } finally { visibility.dispose(); disposeStairGeometry(stairs) }
  }
})

test('ordinary furniture keeps conservative bounds and unrelated backfaces outside stair bounds are ignored', () => {
  const scene = new Group(), mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
  scene.add(mesh)
  const visibility = createIndirectVisibility(scene)
  const bounds = { min: [2, 0, -1], max: [4, 2, 1] }, point = new Vector3(3, 1, 0)
  try {
    assert.equal(createIndirectProbeObstacles([bounds], visibility).contains(point), true)
    assert.equal(createIndirectProbeObstacles([{ ...bounds, geometry: true }], visibility).contains(point), false)
    assert.equal(createIndirectProbeObstacles([bounds], visibility).contains(new Vector3(5, 1, 0)), false)
  } finally { visibility.dispose(); mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose() }
})
