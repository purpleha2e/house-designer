import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three'
import { applyWallOpeningPreviewShader, findWallOpeningPreviewMaterial, getWallOpeningPreview } from '../src/wallOpeningPreview.ts'
import { requestShaderWarmup } from '../src/shaderWarmupState.ts'
import type { FloorLevel, SurfaceMaterialAssignment } from '../src/types.ts'
import { buildWallBodyPerimeterMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { prepareWallRendering, resolveWallEngineFinish } from '../src/wallEngine/wallRenderPreparation.ts'
import { createWallBufferGeometry } from '../src/wallEngine/wallThreeGeometry.ts'
import { wallMaterialBatchKey } from '../src/wallEngine/wallMaterialBatchKey.ts'

test('prepared coordinate rounding does not cover an unchanged painted wall with a preview', () => {
  const floor: FloorLevel = { id: 'floor', name: '', elevation: 2.7, roomHeight: 2.4, slabThickness: .3,
    rooms: [], roofs: [], models: [], walls: [{ id: 'bedroom', kind: 'external', height: 2.4, thickness: .3,
      start: { x: 1.73055217385635, y: 10.160690667143697 },
      end: { x: 1.7305521738563503, y: 4.901592948908246 },
      openings: [{ id: 'window', center: 2.1, bottom: .8, width: 1, height: 1 }] }] }
  const prepared = structuredClone(floor.walls)
  prepared[0].end.x = 1.73055217385635
  prepared[0].openings![0].center = 2.1000000000000005
  const scene = new Scene(), geometry = new PlaneGeometry(), material = new MeshStandardMaterial(), mesh = new Mesh(geometry, material)
  Object.assign(mesh.userData, { floorId: floor.id, wallOpeningPreviewEligible: true, wallPreparedWalls: prepared })
  scene.add(mesh)
  const preview = getWallOpeningPreview(scene)
  try {
    preview.update([floor], []); preview.sync()
    assert.equal(preview.active, false, 'sub-micrometre differences are not edits')
    assert.equal(preview.uniforms.hdOpeningPreviewCount.value, 0)
    assert.equal(preview.group.children.length, 0)
    const moved = structuredClone(floor)
    moved.walls[0].end.x += .02
    preview.update([moved], []); preview.sync()
    assert.equal(preview.active, true, 'real wall moves still receive immediate geometry feedback')
  } finally { preview.dispose(); geometry.dispose(); material.dispose() }
})

test('opening patches keep fragment paint on the room side and brick on the exterior', () => {
  const floor: FloorLevel = { id: 'floor', name: '', elevation: 2.7, roomHeight: 2.4, slabThickness: .3,
    rooms: [], roofs: [], models: [], walls: [{ id: 'wall', kind: 'external', height: 2.4, thickness: .3,
      start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }] }
  const wall = floor.walls[0], original = buildWallBodyPerimeterMeshFaces(floor.walls)
  const roomFace = original.find(face => face.kind === 'side' && face.pickSource.side === 1)!
  const panel = (name: string, offset: number) => ({ ...roomFace, faceId: `${roomFace.faceId}:${name}`,
    vertices: roomFace.vertices.map(vertex => ({ ...vertex,
      position: [vertex.position[0] / 2 + offset, vertex.position[1], vertex.position[2]],
    })) as typeof roomFace.vertices })
  const left = panel('left', 0), right = panel('right', 2)
  const faces = [...original.filter(face => face !== roomFace), left, right]
  const assignments: SurfaceMaterialAssignment[] = faces.filter(face => face.kind === 'side')
    .map((face, index) => ({ id: String(index), materialId: face === right ? 'accent' : face.pickSource.side === 1 ? 'paint' : 'brick',
      target: { type: 'wall-surface-fragment', wallId: wall.id, fragmentId: face.faceId, side: face.pickSource.side! } }))
  const wallsById = new Map([[wall.id, wall]])
  const { payload } = prepareWallRendering({ kind: 'render', faces, walls: floor.walls, surfaceAssignments: assignments,
    floorId: floor.id, elevation: floor.elevation })
  const paint = new MeshStandardMaterial({ color: '#eee9dc' }), brick = new MeshStandardMaterial({ color: '#aa0000' })
  const accent = new MeshStandardMaterial({ color: '#0000ff' })
  const finishes = payload.materialSlots.map(slot => resolveWallEngineFinish({ source: slot.source, surfaceAssignments: assignments, wallsById }))
  const geometry = createWallBufferGeometry(payload), mesh = new Mesh(geometry, finishes.map(f =>
    f.assignment?.materialId === 'accent' ? accent : f.assignment?.materialId === 'paint' ? paint : brick))
  mesh.position.y = floor.elevation
  Object.assign(mesh.userData, { floorId: floor.id, wallOpeningPreviewEligible: true, wallPreparedWalls: floor.walls,
    wallMaterialKeys: finishes.map(f => wallMaterialBatchKey(f.assignment, f.fallback)) })
  const scene = new Scene(); scene.add(mesh)
  const opening = { id: 'window', center: 1, bottom: .8, width: 1, height: 1 }
  const preview = getWallOpeningPreview(scene)
  try {
    assert.equal(findWallOpeningPreviewMaterial(mesh, floor, wall, opening, 1, assignments), paint)
    assert.equal(findWallOpeningPreviewMaterial(mesh, floor, wall, { ...opening, center: 3 }, 1, assignments), accent,
      'a patch uses the nearby panel rather than the last fragment assigned on the same wall')
    assert.equal(findWallOpeningPreviewMaterial(mesh, floor, wall, opening, -1, assignments), brick)
    const removed = structuredClone(floor)
    mesh.userData.wallPreparedWalls = [{ ...wall, openings: [opening] }]
    preview.update([removed], assignments); preview.sync()
    const patch = preview.group.children[0] as Mesh
    assert.equal((patch.material as MeshStandardMaterial[])[4].color.getHexString(), 'eee9dc')
    assert.equal((patch.material as MeshStandardMaterial[])[5].color.getHexString(), 'aa0000')
    const unrelated = { ...wall, id: 'new-wall', start: { x: 0, y: 10 }, end: { x: 4, y: 10 } }
    mesh.userData.wallMaterialKeys = []
    assert.equal(findWallOpeningPreviewMaterial(mesh, floor, unrelated, opening, 1, []), undefined,
      'an unknown finish must not silently choose the first, exterior material slot')
  } finally { preview.dispose(); geometry.dispose(); paint.dispose(); brick.dispose(); accent.dispose() }
})

test('moves, additions and removals preview against the displayed wall, then retire when its real mesh arrives', () => {
  const floor: FloorLevel = { id: 'floor', name: '', elevation: 0, roomHeight: 2.4, slabThickness: .2, rooms: [], roofs: [], models: [], walls: [{
    id: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, height: 2.4, thickness: .2, kind: 'external',
    openings: [{ id: 'window', center: 1, bottom: .8, width: 1, height: 1 }],
  }] }
  const scene = new Scene(), geometry = new PlaneGeometry(), material = new MeshStandardMaterial(), mesh = new Mesh(geometry, material)
  Object.assign(mesh.userData, { floorId: 'floor', wallOpeningPreviewEligible: true, wallPreparedWalls: floor.walls })
  scene.add(mesh); applyWallOpeningPreviewShader(material, scene)
  const preview = getWallOpeningPreview(scene), moved = structuredClone(floor)
  moved.walls[0].openings![0].center = 2.5
  try {
    preview.update([moved], []); preview.sync()
    assert.equal(preview.active, true)
    assert.equal(preview.uniforms.hdOpeningPreviewCount.value, 1)
    assert.deepEqual(preview.uniforms.hdOpeningPreviewA.value[0].toArray(), [2.5, .8, 0, .5])
    assert.equal(preview.group.children.length, 2, 'old void is filled and the new reveal is shown')
    assert.equal(preview.sync(), false, 'unchanged frames allocate nothing')
    mesh.userData.wallPreparedWalls = moved.walls; requestShaderWarmup(scene); preview.sync()
    assert.equal(preview.active, false)
    const removed = structuredClone(moved); removed.walls[0].openings = []
    preview.update([removed], []); preview.sync()
    assert.equal(preview.active, true); assert.equal(preview.group.children.length, 1)
    assert.equal(preview.uniforms.hdOpeningPreviewCount.value, 0)
    mesh.userData.wallPreparedWalls = removed.walls; requestShaderWarmup(scene)
    preview.update([moved], []); preview.sync()
    assert.equal(preview.group.children.length, 1, 'adding an opening needs only its new reveal')
    assert.equal(preview.uniforms.hdOpeningPreviewCount.value, 1)
  } finally { preview.dispose(); geometry.dispose(); material.dispose() }
})
