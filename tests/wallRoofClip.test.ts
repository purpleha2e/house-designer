import assert from 'node:assert/strict'
import test from 'node:test'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { clipWallFacesToRoofUndersides, roofFacePlanes, footprintPlanes } from '../src/wallEngine/wallRoofClip.ts'
import type { WallRoofClipVolume } from '../src/wallEngine/wallRoofClip.ts'
import { buildRoofProfileFaces } from '../src/roofProfile.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'

function sideFace(): WallMeshFace {
  return {
    faceId: 'upper-wall:side:1',
    kind: 'side',
    materialSource: { side: 1, wallId: 'upper-wall' },
    normal: [0, 0, 1],
    pickSource: { side: 1, wallId: 'upper-wall' },
    uvSource: { side: 1, wallId: 'upper-wall' },
    vertices: [
      { position: [0, 0, 0], uv: [0, 2.6] },
      { position: [2, 0, 0], uv: [2, 2.6] },
      { position: [2, 2.4, 0], uv: [2, 5] },
      { position: [0, 2.4, 0], uv: [0, 5] },
    ],
    wallId: 'upper-wall',
  }
}

function topFace(): WallMeshFace {
  return {
    faceId: 'upper-wall:top',
    kind: 'top',
    materialSource: { wallId: 'upper-wall' },
    normal: [0, 1, 0],
    pickSource: { wallId: 'upper-wall' },
    uvSource: { wallId: 'upper-wall' },
    vertices: [
      { position: [0, 2.4, 0.15], uv: [0, 0.3] },
      { position: [2, 2.4, 0.15], uv: [2, 0.3] },
      { position: [2, 2.4, -0.15], uv: [2, 0] },
      { position: [0, 2.4, -0.15], uv: [0, 0] },
    ],
    wallId: 'upper-wall',
  }
}

function options(height: (x: number, z: number) => number, minX = -1, maxX = 3): { floorElevation: number; volumes: WallRoofClipVolume[] } {
  return {
    floorElevation: 2.6,
    volumes: [{
      planes: roofFacePlanes([[minX, height(minX, -1), -1], [maxX, height(maxX, -1), -1], [maxX, height(maxX, 1), 1], [minX, height(minX, 1), 1]]),
      excludedWallIds: new Set<string>(), protectedFootprints: [], clipSides: true,
    }],
  }
}

test('worker transport preserves sloping cuts, vertical caps, openings and shared plane ownership', () => {
  for (const height of [() => 4, (x: number, z: number) => 3.2 + x * 0.5 + z * 0.2]) {
    const settings = options(height, 1, 3)
    settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
    settings.volumes.push({ ...settings.volumes[0] })
    const lintel = topFace()
    lintel.normal = [0, -1, 0]; lintel.kind = 'cap'
    lintel.vertices = lintel.vertices.map(v => ({ ...v, position: [v.position[0], 1.8, v.position[2] / 3] })) as WallMeshFace['vertices']
    const faces = [sideFace(), topFace(), lintel]
    const job = structuredClone(createWallRoofClipJob(faces, settings))
    const expected = clipWallFacesToRoofUndersides(faces, settings)
    const actual = runWallRoofClipJob(job)
    const rounded = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? Number(v.toFixed(7)) : v))
    assert.deepEqual(rounded(actual), rounded(expected))
    assert.ok(actual.some(face => face.faceId.includes(':roof-cap:')))
    assert.ok(actual.some(face => face.faceId.includes(':roof-boundary-cap:')))
  }
})

test('distant downward wall boundaries do not fragment an unrelated roof cap', () => {
  const settings = options(() => 4)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  const base = [sideFace(), topFace()]
  const distant = Array.from({ length: 100 }, (_, index) => {
    const face = topFace()
    face.normal = [0, -1, 0]; face.kind = 'bottom'
    face.vertices = face.vertices.map(v => ({ ...v, position: [v.position[0] + index / 50, 0, v.position[2] + 10] })) as WallMeshFace['vertices']
    return face
  })
  const caps = (faces: WallMeshFace[]) => clipWallFacesToRoofUndersides(faces, settings).filter(face => face.faceId.includes(':roof-cap:'))
  assert.deepEqual(caps([...base, ...distant]), caps(base))
})

test('a zero-depth doorway reveal cannot cut a remote vertical roof closure', () => {
  const settings = options(() => 4, 1, 3)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  const reveal: WallMeshFace = { ...topFace(), kind: 'cap', normal: [0, -1, 0],
    faceId: 'remote-door:top-reveal',
    vertices: [[1, 1.8, 10], [1, 1.8, 12], [1, 1.8, 12], [1, 1.8, 10]]
      .map(position => ({ position, uv: [0, 0] })) as WallMeshFace['vertices'] }
  const caps = (faces: WallMeshFace[]) => clipWallFacesToRoofUndersides(faces, settings)
    .filter(face => face.faceId.includes(':roof-boundary-cap:'))
  const expected = caps([topFace()])
  assert.ok(expected.length > 0)
  assert.deepEqual(caps([topFace(), reveal]), expected)
})

test('resolved roof cuts close the full thickness of an upper wall with a sloping cap', () => {
  const settings = options((x, z) => 3.2 + x * 0.5 + z * 0.2)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  const result = clipWallFacesToRoofUndersides([sideFace(), topFace()], settings)
  const caps = result.filter((face) => face.faceId.includes(':roof-cap:'))
  assert.ok(caps.length > 0)
  const points = caps.flatMap((face) => face.vertices.map((v) => v.position))
  assert.equal(Math.min(...points.map((p) => p[2])), -0.15)
  assert.equal(Math.max(...points.map((p) => p[2])), 0.15)
  assert.ok(points.every(([x, y, z]) => Math.abs(y + 2.6 - (3.2 + x * 0.5 + z * 0.2)) < 1e-8))
  assert.ok(caps.every((face) => face.normal[1] > 0.8 && face.normal[0] < 0))
})

test('a roof footprint closes a vertical cut across a wall top already split at the cut', () => {
  const settings = options(() => 4, 1, 3)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  settings.volumes.push({ ...settings.volumes[0] })
  const left = topFace(), right = topFace()
  left.vertices = left.vertices.map((v) => ({ ...v, position: [v.position[0] / 2, v.position[1], v.position[2]] })) as WallMeshFace['vertices']
  right.vertices = right.vertices.map((v) => ({ ...v, position: [1 + v.position[0] / 2, v.position[1], v.position[2]] })) as WallMeshFace['vertices']
  const lintel = topFace()
  lintel.normal = [0, -1, 0]; lintel.kind = 'cap'
  lintel.vertices = lintel.vertices.map((v) => ({ ...v, position: [v.position[0], 1.8, v.position[2] / 3] })) as WallMeshFace['vertices']
  const caps = clipWallFacesToRoofUndersides([left, right, lintel], settings)
    .filter((face) => face.faceId.includes(':roof-boundary-cap:'))
  assert.ok(caps.length > 0)
  const area = caps.reduce((sum, face) => {
    const [a, b, c] = face.vertices.map((v) => v.position)
    return sum + Math.abs((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / 2
  }, 0)
  assert.ok(Math.abs(area - 0.26) < 1e-8, 'one cap closes the wall thickness, excluding the window void')
  assert.ok(caps.every((face) => face.normal[0] === 1 && face.wallId === 'upper-wall' && face.vertices.every(({ position: [x, y, z] }) =>
    Math.abs(x - 1) < 1e-8 && y >= 1.4 - 1e-8 && y <= 2.4 + 1e-8 && (Math.abs(z) >= 0.05 - 1e-8 || y >= 1.8 - 1e-8))))
})

test('a vertical junction closure inherits the touching facade side and UV frame', () => {
  const settings = options(() => 4, 1, 3)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  settings.volumes[0].excludedWallIds = new Set(['facade'])
  const facade: WallMeshFace = { ...sideFace(), faceId:'facade', wallId:'facade', normal:[1,0,0],
    materialSource:{wallId:'facade',side:1}, pickSource:{wallId:'facade',side:1}, uvSource:{wallId:'facade',side:1},
    vertices:[[1,0,-0.45],[1,0,-0.15],[1,2.4,-0.15],[1,2.4,-0.45]]
      .map(position=>({position,uv:[position[2]*2+10,position[1]+2.6]})) as WallMeshFace['vertices'] }
  const caps = clipWallFacesToRoofUndersides([topFace(),facade], settings)
    .filter(f=>f.faceId.includes(':roof-boundary-cap:')&&f.normal[0]>0.99)
  assert.ok(caps.length > 0)
  assert.ok(caps.every(f=>f.wallId==='facade'&&f.pickSource.side===1&&f.materialSource.wallId==='facade'))
  assert.ok(caps.every(f=>f.materialSource.fragmentId==='facade'))
  assert.ok(caps.every(f=>f.vertices.every(v=>Math.abs(v.uv[0]-(v.position[2]*2+10))<1e-7&&Math.abs(v.uv[1]-v.position[1]-2.6)<1e-7)))
})

test('roof cut caps respect window voids and do not duplicate overlapping roof coverage', () => {
  const settings = options(() => 4)
  settings.volumes[0].surfacePlane = settings.volumes[0].planes.at(-1)
  settings.volumes.push({ ...settings.volumes[0] })
  const lintel = topFace()
  lintel.kind = 'cap'; lintel.normal = [0, -1, 0]; lintel.faceId = 'lintel'
  lintel.vertices = lintel.vertices.map((v) => ({ ...v, position: [0.5 + v.position[0] / 2, 1.8, v.position[2]] })) as WallMeshFace['vertices']
  const result = clipWallFacesToRoofUndersides([topFace(), lintel], settings)
  const caps = result.filter((face) => face.faceId.includes(':roof-cap:'))
  assert.ok(caps.length > 0)
  assert.ok(caps.every((face) => {
    const x = face.vertices.slice(0, 3).reduce((sum, v) => sum + v.position[0], 0) / 3
    return x <= 0.5 || x >= 1.5
  }))
  const area = caps.reduce((sum, face) => {
    const [a, b, c] = face.vertices.map((v) => v.position)
    return sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2
  }, 0)
  assert.ok(Math.abs(area - 0.3) < 1e-8)
})

test('clips upper-floor side faces exactly at the sloping roof plane and preserves UVs', () => {
  const clipped = clipWallFacesToRoofUndersides([sideFace()], options((x) => 3.2 + x * 0.5))
  assert.ok(clipped.length > 0)
  for (const face of clipped) for (const v of face.vertices) {
    assert.ok(v.position[1] + 2.6 <= 3.2 + v.position[0] * 0.5 + 1e-8)
    assert.ok(Math.abs(v.uv[1] - v.position[1] - 2.6) < 1e-8)
  }
})

test('removes wall sections entirely above a roof and leaves outside faces unsplit', () => {
  assert.deepEqual(clipWallFacesToRoofUndersides([sideFace()], options(() => 2.4)), [])
  const face = sideFace()
  assert.deepEqual(clipWallFacesToRoofUndersides([face], options(() => 3, 3, 4)), [face])
})

test('preserves exposed tops and cuts covered portions at the exact footprint boundary', () => {
  const clipped = clipWallFacesToRoofUndersides([topFace()], options(() => 4.5, 1.013, 3))
  assert.ok(clipped.length > 0)
  assert.ok(clipped.every((face) => face.vertices.every((v) => v.position[0] <= 1.013 + 1e-8)))
  assert.ok(clipped.some((face) => face.vertices.some((v) => Math.abs(v.position[0] - 1.013) < 1e-8)))
})

test('a triangular top crossing a diagonal roof intersection has no protruding tips', () => {
  const top = topFace()
  top.vertices[3] = top.vertices[2]
  const clipped = clipWallFacesToRoofUndersides([top], options((x, z) => 4 + x + z))
  assert.ok(clipped.length > 0)
  assert.ok(clipped.every((face) => face.vertices.every((v) => 5 <= 4 + v.position[0] + v.position[2] + 1e-8)))
})

test('shared top caps protect only the abutting wall footprint, without long triangle tips', () => {
  const settings = options(() => 4)
  settings.volumes[0].protectedFootprints.push(footprintPlanes([
    { x: 0, y: -1 }, { x: 0.317, y: -1 }, { x: 0.317, y: 1 }, { x: 0, y: 1 },
  ]))
  const top = topFace()
  top.vertices[3] = top.vertices[2]
  const clipped = clipWallFacesToRoofUndersides([top], settings)
  assert.ok(clipped.length > 0)
  assert.ok(clipped.every((face) => face.vertices.every((v) => v.position[0] <= 0.317 + 1e-8)))
})

test('separate top fragments remain when other fragments of the same wall are trimmed', () => {
  const outside = topFace()
  outside.vertices = outside.vertices.map((v) => ({ ...v, position: [v.position[0] + 5, v.position[1], v.position[2]] })) as WallMeshFace['vertices']
  const clipped = clipWallFacesToRoofUndersides([sideFace(), topFace(), outside], options(() => 3.6))
  assert.deepEqual(clipped.filter((face) => face.kind === 'top'), [outside])
})

test('walls on the exact roof boundary are clipped without duplicate coplanar fragments', () => {
  const face = sideFace()
  face.vertices = face.vertices.map((v) => ({ ...v, position: [v.position[0], v.position[1], -1] })) as WallMeshFace['vertices']
  const clipped = clipWallFacesToRoofUndersides([face], options(() => 3))
  assert.ok(clipped.length > 0)
  assert.ok(clipped.every((f) => f.vertices.every((v) => v.position[1] <= 0.4 + 1e-8)))
})

test('a same-floor roof can remove covered caps while preserving its supporting wall sides', () => {
  const side = sideFace()
  const settings = options(() => 4)
  settings.volumes[0].clipSides = false
  assert.deepEqual(clipWallFacesToRoofUndersides([side, topFace()], settings), [side])
})

test('hip profile intersections remain finite with collinear and duplicate corner vertices', () => {
  const faces = buildRoofProfileFaces({
    id: 'hip', type: 'hip', width: 8, depth: 6, pitchDegrees: 37, overhangPitchDegrees: 0,
    position: { x: 0, y: 0 }, rotation: 0,
  }, { minX: -4, maxX: 4, minY: -3, maxY: 3 }, { minX: -3.5, maxX: 3.2, minY: -2.5, maxY: 2.8 })
  for (const face of faces) {
    const planes = roofFacePlanes(face)
    assert.ok(planes.length >= 4)
    assert.ok(planes.every((plane) => Number.isFinite(plane([0, 0, 0]))))
  }
})
