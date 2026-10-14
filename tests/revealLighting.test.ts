import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
import { createWallBufferGeometry } from '../src/wallEngine/wallThreeGeometry.ts'
import { clipWallFacesToRoofUndersides } from '../src/wallEngine/wallRoofClip.ts'
import { getWallMountedRevealDepth } from '../src/wallMountedReveal.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import { wallLightingCornerPlanes } from '../src/wallEngine/wallLightingCorners.ts'

test('inside wall corners constrain the lighting footprint while outside corners stay open', () => {
  const walls: Wall[] = [
    { id: 'north', kind: 'internal', height: 2.4, thickness: .3, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    { id: 'west', kind: 'internal', height: 2.4, thickness: .1, start: { x: 0, y: 0 }, end: { x: 0, y: 4 } },
  ]
  const faces = buildWallMeshFaces(walls), corners = wallLightingCornerPlanes(faces)
  const inside = faces.filter(face => face.normal[0] > .9 || face.normal[2] > .9)
  assert.ok(inside.some(face => corners.get(face)?.length), 'concave room corner receives an adjoining plane')
  for (const [face, planes] of corners) for (const [nx, nz, d] of planes) {
    const center = face.vertices.reduce((p, v) => [p[0] + v.position[0] / 4, p[1] + v.position[2] / 4], [0, 0])
    assert.ok(center[0] * nx + center[1] * nz > d, 'constraint points into the visible room')
    assert.ok(planes.length <= 2)
  }
  assert.ok(faces.filter(face => face.normal[0] < -.9 || face.normal[2] < -.9).every(face => !corners.has(face)),
    'convex exterior corners retain ordinary sampling')
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor', materialBatchKey: () => 'paint' })
  const geometry = createWallBufferGeometry(payload)
  for (let i = 0; i < 2; i++) assert.equal(geometry.getAttribute(`hdGICorner${i}`).count, geometry.getAttribute('position').count)
  geometry.dispose()
})

test('corner constraints follow rotated, clipped walls and leave a freestanding wall unchanged', () => {
  const angle = .63, c = Math.cos(angle), s = Math.sin(angle)
  const point = (x: number, y: number) => ({ x: 5 + x * c - y * s, y: -2 + x * s + y * c })
  const walls: Wall[] = [
    { id: 'a', kind: 'internal', height: 3, thickness: .3, start: point(0, 0), end: point(4, 0) },
    { id: 'b', kind: 'internal', height: 3, thickness: .1, start: point(0, 0), end: point(0, 4) },
  ]
  const faces = clipWallFacesToRoofUndersides(buildWallMeshFaces(walls), { floorElevation: 0, volumes: [{
    planes: [([, y]) => y - 2.2], protectedFootprints: [], excludedWallIds: new Set(), clipSides: true,
  }] })
  const corners = wallLightingCornerPlanes(faces)
  assert.ok(corners.size > 0, 'roof-clipped corner triangles retain the adjoining half-plane')
  for (const planes of corners.values()) for (const [nx, nz] of planes) {
    assert.ok(Math.abs(nx) > .5 && Math.abs(nz) > .5, 'constraints use actual rotated normals')
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < .000001)
  }
  assert.equal(wallLightingCornerPlanes(buildWallMeshFaces([walls[0]])).size, 0,
    'unconnected wall ends do not invent a room boundary')
})

test('an open interior door keeps the bedroom jamb on the bedroom lighting side of a thick wall', () => {
  const definition: ModelDefinition = { id: 'door', name: 'Door', category: 'Doors', color: '#ffffff',
    shape: 'box', width: .97, height: 2.1, depth: 1, wallMount: 'interior-door', sourceUrl: '/door.glb' }
  const wall: Wall = { id: 'bedroom', kind: 'external', height: 2.4, thickness: .3,
    start: { x: 1.73055, y: 10.16069 }, end: { x: 4.22781, y: 10.16069 },
    openings: [{ id: 'door', modelId: 'door', center: 1.91842, width: .97, bottom: 0, height: 2.1 }] }
  const faces = buildWallMeshFaces([wall], { exteriorWallSidesByWallId: new Map([[wall.id, 1]]),
    wallOpeningDepthsByModelId: new Map([['door', getWallMountedRevealDepth(definition)]]) })
  const jamb = faces.find(face => face.faceId.includes('opening:door:right:-1'))!
  assert.ok(jamb)
  const depths = jamb.vertices.map(vertex => vertex.position[2])
  assert.ok(Math.max(...depths) - Math.min(...depths) > .2,
    'the front reveal must have area; a one-metre swinging-leaf bound used to collapse it to zero')
  assert.ok(jamb.lightingReceiverPlane && jamb.lightingReceiverPlane[1] < 0,
    'the front reveal samples the bedroom, away from the hall')
})

for (const angle of [0, .63, Math.PI]) for (const exteriorSide of [-1, 1] as const) {
  test(`reveal receivers stay on their owning wall side after clipping and batching (${angle}, ${exteriorSide})`, () => {
    const dx = Math.cos(angle), dz = Math.sin(angle), nx = -dz, nz = dx
    const wall: Wall = { id: 'window-wall', kind: 'external', height: 3, thickness: .3,
      start: { x: 5, y: -2 }, end: { x: 5 + dx * 4, y: -2 + dz * 4 },
      openings: [{ id: 'window', modelId: 'window', center: 2, width: 2, bottom: .6, height: 1.4 }] }
    const original = buildWallMeshFaces([wall], { exteriorWallSidesByWallId: new Map([[wall.id, exteriorSide]]) })
    const faces = clipWallFacesToRoofUndersides(original, { floorElevation: 2.7, volumes: [{
      planes: [([x, , z]) => (x - 5) * dx + (z + 2) * dz - 2.5],
      protectedFootprints: [], excludedWallIds: new Set(), clipSides: true,
    }] })
    assert.ok(faces.some(face => face.lightingReceiverPlane))
    assert.ok(faces.length !== original.length, 'exercise clipped reveal triangles')
    const payload = buildWallBufferGeometryPayload(faces, { floorId: 'upper', materialBatchKey: () => 'one-finish' })
    const geometry = createWallBufferGeometry(payload), position = geometry.getAttribute('position')
    const offsets = geometry.getAttribute('hdGIReceiverOffset')
    assert.equal(offsets.count, position.count)
    faces.forEach((face, index) => {
      for (let vertex = index * 6; vertex < index * 6 + 6; vertex++) {
        const shift = Math.hypot(offsets.getX(vertex), offsets.getY(vertex), offsets.getZ(vertex))
        if (!face.lightingReceiverPlane) { assert.equal(shift, 0); continue }
        const side = face.materialSource.side!
        const receiverDepth = (position.getX(vertex) + offsets.getX(vertex) - 5) * nx +
          (position.getZ(vertex) + offsets.getZ(vertex) + 2) * nz
        assert.ok(Math.abs(receiverDepth - side * .23) < .000001,
          'every point across a reveal classifies beyond its owning face, including the exterior half')
        assert.equal(offsets.getY(vertex), 0, 'upper-storey heights are not shifted')
      }
    })
    geometry.dispose()
  })
}
