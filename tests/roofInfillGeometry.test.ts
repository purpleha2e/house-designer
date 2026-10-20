import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { carveRoofInfillByRooms, createRoofInfillGeometry } from '../src/roofInfillGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { getRoofRenderableOuterFaces } from '../src/roofJunctions.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
import { createWallBufferGeometry } from '../src/wallEngine/wallThreeGeometry.ts'
import { buildStoreyGeometry } from '../src/storeyGeometry.ts'
import { getFloorSlabFootprints } from '../src/ceilingSlabFootprint.ts'
import type { FloorLevel } from '../src/types.ts'

test('Colin rear lean-to stays sealed after slab clipping and Float32 rounding', () => {
  const { floors } = JSON.parse(readFileSync(new URL('../colin_house_v2.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const [ground, upper] = floors
  const roofs = resolveBuildingRoofs(floors)
  const candidate = roofs.find(r => r.roof.id === '09d33248-d778-4dd4-b13e-903f2e45cb49')!
  const renderedWall = getRenderedWalls(ground.walls).find(r => r.wall.id === 'b79625cc-003b-4c41-af3d-b4289027a193')!
  const source = createRoofInfillGeometry({ bottomY: ground.elevation + ground.roomHeight,
    infillFaces: getRoofRenderableOuterFaces(candidate.resolved), renderedWall, roof: candidate.roof, exteriorSide: -1 })!
  const bottomY = ground.elevation + ground.roomHeight
  const infill = carveRoofInfillByRooms(source, buildBuildingRoomVolumes(floors, roofs).cuts, ground.id, bottomY)
  if (infill !== source) source.dispose()
  const storeys = buildStoreyGeometry(floors.map(floor => ({ floor, footprints: getFloorSlabFootprints(floor),
    faces: buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(floor.walls),
      rooms: buildWallTopology(floor.walls).rooms, useWallBodyPerimeterMesh: true, roomSurfaceRendererEnabled: true }) })))
  const upperFaces = storeys.get(upper.id)!.wallFaces
  const upperGeometry = createWallBufferGeometry(buildWallBufferGeometryPayload(upperFaces, { floorId: upper.id }))
  const groundGeometry = createWallBufferGeometry(buildWallBufferGeometryPayload(storeys.get(ground.id)!.wallFaces, { floorId: ground.id }))
  // The buffer's material slots are irrelevant to the geometry probe.
  upperGeometry.clearGroups()
  groundGeometry.clearGroups()
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const infillMesh = new Mesh(infill, material), wallMesh = new Mesh(upperGeometry, material)
  const groundMesh = new Mesh(groundGeometry, material)
  groundMesh.position.y = ground.elevation
  groundMesh.updateMatrixWorld()
  wallMesh.position.y = upper.elevation
  wallMesh.updateMatrixWorld()
  const seamX = Math.fround(upperFaces.filter(face => face.wallId === 'a6d57d01-085b-4efb-99c5-553dc1b3eb82' && face.normal[2] < -.99)
    .flatMap(face => face.vertices.map(vertex => vertex.position[0])).reduce((min, x) => Math.min(min, x), Infinity))
  const facadeZ = renderedWall.wall.start.y - renderedWall.wall.thickness / 2
  try {
    for (const y of [2.45, 2.65, 2.7, 2.701, 2.702, 2.8, 3, 3.3]) for (const offset of [-.0005, -.00005, -.0000001, 0, .0000001, .00005, .0005]) {
      const origin = new Vector3(seamX + offset, y, facadeZ - .05)
      const hits = new Raycaster(origin, new Vector3(0, 0, 1), 0, .050001)
        .intersectObjects([infillMesh, wallMesh, groundMesh])
      assert.ok(hits.length, `open seam at height ${y}, offset ${offset}`)
    }
    const positions = infill.getAttribute('position')
    assert.ok([...Array(positions.count).keys()].every(i => Math.abs(positions.getZ(i) - facadeZ) < 1e-6),
      'the infill uses the adjoining wall face plane')
  } finally {
    infill.dispose(); upperGeometry.dispose(); groundGeometry.dispose(); material.dispose()
  }
})
