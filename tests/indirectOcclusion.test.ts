import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { createIndirectSegmentQuery } from '../src/indirectSegmentQuery.ts'

test('any-blocker segments match nearest-hit visibility across solids, openings and both face directions', () => {
  const scene = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshStandardMaterial()
  for (const [x, y, z, sx, sy, sz] of [[0, 1, 0, .08, 2, 8], [2, 1, -2, .1, 2, 2],
    [2, 1, 2, .1, 2, 2], [2, 2.5, 0, .1, 1, 2], [1, .7, 1, 1, .15, 2]]) {
    const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); scene.add(mesh)
  }
  const visibility = createIndirectVisibility(scene)
  let seed = 42
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32)
  const origin = new Vector3(), direction = new Vector3()
  for (let i = 0; i < 4000; i++) {
    origin.set(random() * 8 - 4, random() * 3, random() * 8 - 4)
    direction.set(random() - .5, random() - .5, random() - .5).normalize()
    if (i % 4 === 0) direction.set(1, 0, 0)
    const max = .001 + random() * 8
    assert.equal(visibility.occluded(origin, direction, max), visibility.distance(origin, direction, max) < max, `segment ${i}`)
  }
  // The same near and far tolerances used by thin-partition regressions.
  origin.set(-1, 1, 0); direction.set(1, 0, 0)
  assert.equal(visibility.occluded(origin, direction, .95), false)
  assert.equal(visibility.occluded(origin, direction, .97), true)
  origin.set(.02, 1, 0)
  assert.equal(visibility.occluded(origin, direction, .024), false)
  visibility.dispose(); geometry.dispose(); material.dispose()
})

test('empty geometry never occludes a segment', () => {
  const visibility = createIndirectVisibility(new Group())
  assert.equal(visibility.occluded(new Vector3(), new Vector3(0, 1, 0), 100), false)
  visibility.dispose()
})

test('segment traversal covers every material-group root and rejects zero-length directions', () => {
  const geometry = new BoxGeometry(2, 2, 2)
  const tree = new MeshBVH(geometry), occluded = createIndirectSegmentQuery(tree), ray = new Ray()
  for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
    ray.origin.set(0, 0, 0).setComponent(axis, sign * 3)
    ray.direction.set(0, 0, 0).setComponent(axis, -sign)
    for (const max of [1.99, 2, 2.01, 10]) {
      assert.equal(occluded(ray.origin, ray.direction, max), (tree.raycastFirst(ray, DoubleSide, .025, max)?.distance ?? max) < max)
    }
  }
  assert.equal(occluded(new Vector3(), new Vector3(), 10), false)
  geometry.dispose()
})
