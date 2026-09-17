import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { carveRoofSurfaceByRooms } from '../src/roofRoomCsg.ts'

test('a room prism below a sloped outer panel leaves its triangles and UVs untouched', () => {
  const panel = new BufferGeometry()
  panel.setAttribute('position', new Float32BufferAttribute([
    -2, 1, -2, 2, 3, -2, 2, 3, 2,
  ], 3))
  panel.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  panel.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2))
  const carved = carveRoofSurfaceByRooms(panel, [{
    face: [[0, 1.2, -1], [1, 1.2, -1], [1, 1.2, 1], [0, 1.2, 1]],
    thickness: 0, bottomY: -1,
  }])
  assert.equal(carved, panel)
  assert.equal(carved.getAttribute('position').count, 3)
  assert.deepEqual(Array.from(carved.getAttribute('uv').array), [0, 0, 1, 0, 1, 1])
  panel.dispose()
})

test('room volume removes a crossing soffit within the room inner skin and preserves the rest', () => {
  const roof = new BufferGeometry()
  roof.setAttribute('position', new Float32BufferAttribute([
    -2, 1, -2, 2, 1, -2, 2, 1, 2,
    -2, 1, -2, 2, 1, 2, -2, 1, 2,
  ], 3))
  roof.setAttribute('normal', new Float32BufferAttribute(Array(18).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3))
  roof.setAttribute('uv', new Float32BufferAttribute([0,0, 1,0, 1,1, 0,0, 1,1, 0,1], 2))
  const carved = carveRoofSurfaceByRooms(roof, [{
    face: [[-1, 1.2, -1], [1, 1.2, -1], [1, 1.2, 1], [-1, 1.2, 1]],
    thickness: 0.04, bottomY: -1,
  }])
  assert.ok(carved.getAttribute('position').count > 0)
  const positions = carved.getAttribute('position')
  for (let i = 0; i < positions.count; i += 3) {
    const cx = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3
    const cz = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3
    assert.ok(Math.abs(cx) >= 1 - 1e-5 || Math.abs(cz) >= 1 - 1e-5,
      `triangle remains inside carved room at ${cx}, ${cz}`)
  }
  carved.dispose()
  roof.dispose()
})

test('room volume removes a horizontal tile beneath a sloped room ceiling', () => {
  const tile = new BufferGeometry()
  tile.setAttribute('position', new Float32BufferAttribute([
    -1, 1, -1, 1, 1, -1, 1, 1, 1,
    -1, 1, -1, 1, 1, 1, -1, 1, 1,
  ], 3))
  tile.setAttribute('normal', new Float32BufferAttribute(Array(18).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3))
  tile.setAttribute('uv', new Float32BufferAttribute([0,0, 1,0, 1,1, 0,0, 1,1, 0,1], 2))
  const carved = carveRoofSurfaceByRooms(tile, [{
    face: [[-2, 1.5, -2], [2, 2.5, -2], [2, 2.5, 2], [-2, 1.5, 2]],
    thickness: 0, bottomY: -1,
  }])
  assert.equal(carved.getAttribute('position').count, 0)
  if (carved !== tile) carved.dispose()
  tile.dispose()
})
