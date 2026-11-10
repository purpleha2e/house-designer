import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Ray, Vector3 } from 'three'
import { buildRoomLightOcclusion, type RoomLightOcclusion } from '../src/roomLightOcclusion.ts'
import { indirectOctUV, snapshotIndirectGeometry } from '../src/indirectVisibility.ts'

function blocked(atlas: RoomLightOcclusion, light: number, target: Vector3) {
  const source = new Vector3().fromArray(atlas.lights[light].position), delta = target.clone().sub(source), distance = delta.length()
  const uv = indirectOctUV(delta), size = atlas.size
  const px = Math.max(0, Math.min(size - 1, uv.x * size - .5)), py = Math.max(0, Math.min(size - 1, uv.y * size - .5))
  const start = atlas.records[light * 4 + 3] * 4, ids = new Set<number>()
  let enclosed = true
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const address = start + (Math.min(size - 1, Math.floor(py) + y) * size + Math.min(size - 1, Math.floor(px) + x)) * 2
    const id = atlas.records[address]
    ids.add(id)
    enclosed &&= id > 0 && atlas.records[address + 1] < distance - .003 - distance * 4 / size
  }
  const ray = new Ray(source, delta.normalize()), hit = new Vector3()
  for (const id of ids) if (id) for (const triangle of [1, 4]) {
    const base = (atlas.triangles + (id - 1) * 7 + triangle) * 4
    if (ray.intersectTriangle(new Vector3().fromArray(atlas.records, base), new Vector3().fromArray(atlas.records, base + 4),
      new Vector3().fromArray(atlas.records, base + 8), false, hit) && hit.distanceTo(source) < distance - .003) return true
  }
  return enclosed
}

test('fine tessellation cannot open bright slits through an otherwise solid blocker', () => {
  const group = new Group(), material = new MeshStandardMaterial(), geometries: BoxGeometry[] = []
  for (const [x, width] of [[-.5005, .999], [0, .002], [.5005, .999]]) {
    const geometry = new BoxGeometry(width, 2, .1), part = new Mesh(geometry, material)
    geometries.push(geometry); part.position.set(x, 0, 1); group.add(part)
  }
  try {
    const atlas = buildRoomLightOcclusion(snapshotIndirectGeometry(group), [{ id: 'lamp', position: [0, 0, 0] }], 32)
    assert.ok(blocked(atlas, 0, new Vector3(0, 0, 3)), 'an unsampled thin strip between sampled faces remains opaque')
    assert.equal(blocked(atlas, 0, new Vector3(0, 0, .95)), false, 'the receiving surface does not shadow itself')
    assert.equal(blocked(atlas, 0, new Vector3(4, 0, 3)), false, 'clear paths beyond the silhouette remain open')
  } finally { geometries.forEach(g => g.dispose()); material.dispose() }
})

test('cross-storey fallback blocks solid stairs and preserves clear paths at translated and rotated locations', () => {
  for (const rotation of [0, .7]) {
    const group = new Group(), geometry = new BoxGeometry(2, .14, 4), material = new MeshStandardMaterial()
    const stairs = new Mesh(geometry, material); stairs.rotation.x = -.35; stairs.position.y = 1.8
    group.add(stairs); group.rotation.y = rotation; group.position.set(12 * rotation, 2 * rotation, -7 * rotation)
    group.updateMatrixWorld(true)
    const source = group.localToWorld(new Vector3(0, .7, 0))
    const lights = [{ id: 'under-stairs', position: source.toArray() }, { id: 'outside', position: group.localToWorld(new Vector3(4, 3, 0)).toArray() }]
    const atlas = buildRoomLightOcclusion(snapshotIndirectGeometry(group), lights, 64)
    assert.ok(blocked(atlas, 0, group.localToWorld(new Vector3(0, 3.5, .5))), 'solid stair flight blocks the lower lamp')
    assert.equal(blocked(atlas, 0, group.localToWorld(new Vector3(4, 3, 0))), false, 'light can pass beside the stairs')
    assert.equal(blocked(atlas, 1, group.localToWorld(new Vector3(4, 4, 1))), false, 'each lamp owns its own visibility records')
    stairs.removeFromParent()
    const edited = buildRoomLightOcclusion(snapshotIndirectGeometry(group), lights, 64)
    assert.equal(blocked(edited, 0, group.localToWorld(new Vector3(0, 3.5, .5))), false, 'removing a blocker opens the path')
    geometry.dispose(); material.dispose()
  }
})

test('candidate cells do not expand a blocker silhouette into an adjacent opening', () => {
  const group = new Group(), geometry = new BoxGeometry(1, .1, 2), material = new MeshStandardMaterial()
  const ceiling = new Mesh(geometry, material); ceiling.position.set(0, 2, 0); group.add(ceiling)
  const atlas = buildRoomLightOcclusion(snapshotIndirectGeometry(group), [{ id: 'lamp', position: [0, 1, 0] }], 32)
  assert.ok(blocked(atlas, 0, new Vector3(.5, 3, 0)))
  // Just beyond the actual far edge of the slab; nearby angular candidates
  // still reference it, so a depth-only lookup would incorrectly block this.
  assert.equal(blocked(atlas, 0, new Vector3(1.1, 3, 0)), false)
  geometry.dispose(); material.dispose()
})
