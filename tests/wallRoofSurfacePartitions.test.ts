import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolveBuildingRoofs, getRoofSupportBoundsInRoofSpace, getRoofWorldPointFromLocal } from '../src/roofBuildingGeometry.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { getRoofCoverageUndersideFaces } from '../src/roofJunctions.ts'
import { clipWallFacesToRoofUndersides } from '../src/wallEngine/wallRoofClip.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { buildCoplanarWallSurfaceGroups } from '../src/wallEngine/wallSurfaceGroups.ts'
import type { FloorLevel } from '../src/types.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { getBaySupportPolygon } from '../src/bayRoof.ts'
import { createWallRoofSurfaceDividers, partitionWallFacesAtRoofs, isRoofRegionSubdivision } from '../src/wallEngine/wallRoofSurfacePartitions.ts'
import { buildCeilingSlabFootprints } from '../src/ceilingSlabFootprint.ts'
import { findWallFragmentAssignmentForFace } from '../src/wallFragmentAssignments.ts'

test('Springfield overhang and open canopy stay exterior while the adjoining room keeps its finish', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/springfield_13.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const upper = floors[1]
  const footprints = new Map(floors.map(f => [f.id, buildCeilingSlabFootprints(f.walls)]))
  const roofs = resolveBuildingRoofs(floors).map(({ roof, resolved, floorId }) => {
    const b = getRoofSupportBoundsInRoofSpace(roof)
    return { roofId: roof.id, floorId, surfaceFaces: resolved.structuralFaces,
      undersideFaces: getRoofCoverageUndersideFaces(resolved), enclosedFootprints: footprints.get(floorId),
      supportPolygon: [{ x:b.minX,y:b.minY },{ x:b.maxX,y:b.minY },{ x:b.maxX,y:b.maxY },{ x:b.minX,y:b.maxY }]
        .map(p => getRoofWorldPointFromLocal(roof, p)),
    }
  })
  const options = createWallRoofClipOptions({ floorElevation: upper.elevation, floorId: upper.id, walls: upper.walls, roofs })
  const facade = (wallId: string, normal: WallMeshFace['normal'], points: number[][]): WallMeshFace => ({
    faceId: `facade-${wallId}`, wallId, kind: 'side', normal,
    materialSource: { wallId, side: 1 }, pickSource: { wallId, side: 1 }, uvSource: { wallId, side: 1 },
    vertices: points.map(position => ({ position, uv: [position[0] + position[2], position[1] + upper.elevation] })) as WallMeshFace['vertices'],
  })
  const side = facade('b0ebccfb-76de-40f2-a05f-ed79c4176ee0', [-1,0,0],
    [[5.3596275818,0,7.7],[5.3596275818,0,10],[5.3596275818,2.4,10],[5.3596275818,2.4,7.7]])
  const rear = facade('cc68aecd-58eb-476d-a29b-996164b1c4a1', [0,0,1],
    [[8,0,11.9369930114],[14.5,0,11.9369930114],[14.5,2.4,11.9369930114],[8,2.4,11.9369930114]])
  const sideParts = partitionWallFacesAtRoofs([side], options.surfaceDividers, upper.elevation)
  const rearParts = partitionWallFacesAtRoofs([rear], options.surfaceDividers, upper.elevation)
  const strip = hit(sideParts, 8.65, 0.4), interior = hit(sideParts, 8.4, 0.4)
  // Reuse the 2D triangle probe with the rear facade's horizontal axis.
  const rearAt = (x: number, y: number) => {
    const projected = rearParts.map(f => ({ ...f, vertices: f.vertices.map(v => ({ ...v,
      position: [v.position[2], v.position[1], v.position[0]],
    })) as WallMeshFace['vertices'] }))
    return hit(projected, x, y)
  }
  const canopy = rearAt(9.6, 0.2), porchInterior = rearAt(12, 0.2)
  assert.equal(strip.roofSurfaceRegion, 'roof-exposed')
  assert.equal(canopy.roofSurfaceRegion, 'roof-exposed')
  assert.ok(interior.roofSurfaceRegion?.includes(':below'))
  assert.ok(porchInterior.roofSurfaceRegion?.includes(':below'))
  for (const [parts, exterior, inside] of [[sideParts, strip, interior], [rearParts, canopy, porchInterior]] as const) {
    const above = parts.find(f => f.roofSurfaceRegion === 'roof-exposed' && f.faceId === exterior.faceId &&
      f.vertices.some(v => v.position[1] > 1.5))!
    assert.ok(above, 'exposed patches inherit the existing above-roof fragment ID')
    const assignment = { id: 'saved-brick', materialId: 'brick', target: {
      type: 'wall-surface-fragment' as const, fragmentId: above.faceId, wallId: above.wallId, side: 1 as const,
    } }
    assert.equal(findWallFragmentAssignmentForFace([assignment], exterior), assignment)
    assert.equal(findWallFragmentAssignmentForFace([assignment], inside), undefined)
    const groups = buildCoplanarWallSurfaceGroups(parts)
    assert.ok(!groups.get(exterior.faceId)!.some(f => f.fragmentId === inside.faceId))
  }
  const faces = [side, rear]
  assert.deepEqual(runWallRoofClipJob(structuredClone(createWallRoofClipJob(faces, options))), clipWallFacesToRoofUndersides(faces, options))
})

test('saved roof-region finishes survive a new contact without crossing existing boundaries', () => {
  const saved = 'wall:side:roof-region:/bay:0:above'
  assert.ok(isRoofRegionSubdivision('wall:side:roof-region:/bay:0:above/gable:2:above', saved))
  assert.ok(isRoofRegionSubdivision('wall:side:roof-region:/a:0:below/bay:0:above', saved))
  assert.equal(isRoofRegionSubdivision('wall:side:roof-region:/bay:0:below/gable:2:above', saved), false)
  assert.equal(isRoofRegionSubdivision('other:side:roof-region:/bay:0:above', saved), false)
  assert.equal(isRoofRegionSubdivision('wall:side:roof-region:/bay:0:above', 'wall:side:roof-region:outside'), false)
})

const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/roof_material_regions.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
const upper = floors[1]
const wall = upper.walls[1]
const face: WallMeshFace = {
  faceId: 'upper-facade', wallId: wall.id, kind: 'side', normal: [1, 0, 0],
  materialSource: { wallId: wall.id, side: -1 }, pickSource: { wallId: wall.id, side: -1 },
  uvSource: { wallId: wall.id, side: -1 },
  vertices: [[6.65, 0, 1.35], [6.65, 0, 8.485368234442107], [6.65, 2.4, 8.485368234442107], [6.65, 2.4, 1.35]]
    .map(position => ({ position, uv: [position[2], position[1] + upper.elevation] })) as WallMeshFace['vertices'],
}

test('separate enclosed spans exclude the facade itself and preserve all wall area and UVs', () => {
  const testWall = { ...wall, start: { x:0, y:0 }, end: { x:0, y:8 }, thickness:0.3, height:3 }
  const roof: [number,number,number][][] = [[[-1,1.5,0],[4,1.5,0],[4,1.5,8],[-1,1.5,8]]]
  const rectangle = (minX: number, maxX: number, minZ: number, maxZ: number) =>
    [{x:minX,y:minZ},{x:maxX,y:minZ},{x:maxX,y:maxZ},{x:minX,y:maxZ}]
  const footprints = [rectangle(-0.15,0.15,0,8), rectangle(0.15,4,1,3), rectangle(0.15,4,5,7)]
  const getDividers = (polygons: typeof footprints) => createWallRoofSurfaceDividers('roof', roof, [testWall], 0,
    undefined, rectangle(0,4,0,8), polygons)
  const dividers = getDividers(footprints)
  assert.equal(dividers.length, 1)
  assert.deepEqual(dividers[0].enclosedSpans, [[0.125,0.375],[0.625,0.875]])
  assert.deepEqual(getDividers(footprints.map(p => [...p].reverse()).reverse()), dividers)
  const facade: WallMeshFace = { ...face, wallId: testWall.id, normal: [1,0,0],
    vertices: [[0.15,0,0],[0.15,0,8],[0.15,3,8],[0.15,3,0]].map(position =>
      ({position,uv:[position[2],position[1]]})) as WallMeshFace['vertices'] }
  const parts = partitionWallFacesAtRoofs([facade], dividers, 0)
  for (const z of [0.5,4,7.5]) assert.equal(hit(parts,z,1).roofSurfaceRegion,'roof-exposed')
  for (const z of [2,6]) assert.equal(hit(parts,z,1).roofSurfaceRegion,'roof:below')
  const area = parts.reduce((sum,f) => {
    const [a,b,c] = f.vertices.map(v => v.position)
    return sum + Math.abs((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1])) / 2
  },0)
  assert.ok(Math.abs(area-24)<1e-7)
  assert.ok(parts.every(f => f.vertices.every(v => Math.abs(v.uv[0]-v.position[2])<1e-7 && Math.abs(v.uv[1]-v.position[1])<1e-7)))
  const canopy = partitionWallFacesAtRoofs([facade], getDividers([footprints[0]]), 0)
  assert.ok(canopy.every(f => f.roofSurfaceRegion === 'roof-exposed'), 'an open canopy has no interior finish region')
})
const roofs = resolveBuildingRoofs(floors).map(({ roof, resolved, floorId }) => {
  const b = getRoofSupportBoundsInRoofSpace(roof)
  return { roofId: roof.id, floorId, surfaceFaces: resolved.structuralFaces,
    undersideFaces: getRoofCoverageUndersideFaces(resolved),
    supportPolygon: [{ x:b.minX,y:b.minY },{ x:b.maxX,y:b.minY },{ x:b.maxX,y:b.maxY },{ x:b.minX,y:b.maxY }]
      .map(p => getRoofWorldPointFromLocal(roof, p)),
  }
})
const options = createWallRoofClipOptions({ floorElevation: upper.elevation, floorId: upper.id,
  walls: upper.walls, roofs, isInsideRoom: p => p.x < 6.5 })

function hit(faces: WallMeshFace[], z: number, y: number) {
  return faces.find(f => {
    const points = f.vertices.slice(0, 3).map(v => [v.position[2], v.position[1]])
    const signs = points.map((a, i) => {
      const b = points[(i + 1) % 3]
      return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(z-a[0])
    })
    return signs.every(v => v >= -1e-7) || signs.every(v => v <= 1e-7)
  })!
}

test('the saved adjoining roofs give A-left, A-right and B separate material regions', () => {
  assert.ok(options.surfaceDividers.length >= 2)
  const result = clipWallFacesToRoofUndersides([face], options)
  const left = hit(result, 2.7, 1.8), right = hit(result, 7.5, 1.8), below = hit(result, 5, 0.8)
  assert.ok(left && right && below, 'the complete wall remains present behind the roof')
  assert.equal(left.roofSurfaceRegion, 'roof-exposed')
  assert.equal(right.roofSurfaceRegion, 'roof-exposed')
  assert.notEqual(left.faceId, right.faceId)
  assert.notEqual(left.faceId, below.faceId)
  const groups = buildCoplanarWallSurfaceGroups(result)
  assert.ok(!groups.get(left.faceId)!.some(f => f.fragmentId === right.faceId || f.fragmentId === below.faceId))
  const area = result.reduce((sum, f) => {
    const [a,b,c] = f.vertices.map(v => v.position)
    return sum + Math.abs((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/2
  }, 0)
  assert.ok(Math.abs(area - (8.485368234442107-1.35)*2.4) < 1e-6, 'no removed or duplicate facade area')
  assert.ok(result.every(f => f.vertices.every(v => Math.abs(v.uv[0]-v.position[2]) < 1e-7 &&
    Math.abs(v.uv[1]-v.position[1]-upper.elevation) < 1e-7)), 'UVs stay continuous across roof lines')
})

test('surface regions survive the worker transport and roof list reordering', () => {
  const result = clipWallFacesToRoofUndersides([face], options)
  assert.deepEqual(runWallRoofClipJob(structuredClone(createWallRoofClipJob([face], options))), result)
  const reordered = createWallRoofClipOptions({ floorElevation: upper.elevation, floorId: upper.id,
    walls: upper.walls, roofs: [...roofs].reverse(), isInsideRoom: p => p.x < 6.5 })
  assert.deepEqual(clipWallFacesToRoofUndersides([face], reordered), result)
  const inside = { ...face, faceId: 'inside', normal: [-1, 0, 0] as [number, number, number] }
  assert.deepEqual(clipWallFacesToRoofUndersides([inside], options), [inside], 'the opposite wall finish is unaffected')
})

test('junction material inheritance follows the facade above and below roof contacts', () => {
  const cap = { ...face, faceId: 'top:23:roof-boundary-cap:19:1:0:0',
    materialSource: { ...face.materialSource, fragmentId: face.faceId } }
  const parts = clipWallFacesToRoofUndersides([cap], options)
  assert.ok(parts.some(part => part.faceId.includes(':above')))
  assert.ok(parts.some(part => part.faceId.includes(':below')))
  for (const part of parts) {
    assert.equal(part.materialSource.fragmentId, part.faceId.replace(cap.faceId, face.faceId))
  }
})

test('a roof ridge does not split the connected wall around a doorway', () => {
  const rectangle = (id: string, left: number, right: number, bottom: number, top: number): WallMeshFace => ({
    ...face, faceId: id,
    vertices: [[6.65,bottom,left],[6.65,bottom,right],[6.65,top,right],[6.65,top,left]]
      .map(position => ({ position, uv: [position[2], position[1]] })) as WallMeshFace['vertices'],
  })
  const doorway = [rectangle('left', 0, 3.5, 0, 3), rectangle('lintel', 3.5, 4.5, 2, 3),
    rectangle('right', 4.5, 8, 0, 3)]
  const divided = partitionWallFacesAtRoofs(doorway, [
    { id: 'roof:0', wallId: wall.id, normal: [1,0], start: [6.65,1,0], end: [6.65,3.4,4] },
    { id: 'roof:1', wallId: wall.id, normal: [1,0], start: [6.65,3.4,4], end: [6.65,1,8] },
  ], 0)
  const a = hit(divided, 2, 1), c = hit(divided, 4, 2.5), d = hit(divided, 6, 1)
  const b = hit(divided, 1, 2.5), e = hit(divided, 7, 2.5)
  const groups = buildCoplanarWallSurfaceGroups(divided)
  const ids = (f: WallMeshFace) => groups.get(f.faceId)!.map(ref => ref.fragmentId).sort()
  assert.deepEqual(ids(a), ids(c))
  assert.deepEqual(ids(a), ids(d))
  assert.ok(!ids(a).includes(b.faceId) && !ids(a).includes(e.faceId))
  assert.ok(!ids(b).includes(e.faceId), 'disconnected exposed triangles retain separate finishes')
  assert.ok(a.faceId.includes('roof:0:below') && d.faceId.includes('roof:1:below'),
    'saved face IDs retain their panel-specific paths')
  assert.ok(divided.every(f => f.vertices.every(v => v.position[0] === 6.65 &&
    Math.abs(v.uv[0] - v.position[2]) < 1e-7 && Math.abs(v.uv[1] - v.position[1]) < 1e-7)))
})

test('roof junction extensions only divide the face towards the local roof support', () => {
  const wallAtOrigin = { ...wall, start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, thickness: 0.3, height: 3 }
  const panels: [number, number, number][][] = [[[-1,1.5,0],[4,1.5,0],[4,1.5,2],[-1,1.5,2]]]
  const legacy = createWallRoofSurfaceDividers('roof', panels, [wallAtOrigin], 0)
  assert.equal(legacy.length, 2, 'junction panel extends through both wall faces')
  // This angled support crosses the wall further along, but not at this panel.
  const support = [{ x:0,y:0 },{ x:4,y:0 },{ x:4,y:10 },{ x:-1,y:10 }]
  const dividers = createWallRoofSurfaceDividers('roof', panels, [wallAtOrigin], 0, undefined, support)
  // At z=2 this polygon reaches x=-0.2, so use a shorter contact to keep
  // the complete local footprint inside the wall thickness on the room side.
  const shortPanels = panels.map(f => f.map(([x,y,z]): [number,number,number] => [x,y,z/2]))
  const local = createWallRoofSurfaceDividers('roof', shortPanels, [wallAtOrigin], 0, undefined, support)
  assert.equal(local.length, 1)
  assert.equal(local[0].normal[0], 1)
  assert.equal(local[0].id, legacy.find(d => d.normal[0] === 1)!.id, 'exterior assignment IDs stay stable')
  assert.equal(dividers.length, 2, 'a roof supported on both sides can divide both faces')
})

test('red_house_3 divides partial facade contacts and the angled Bay mounting edge', () => {
  const project = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_material_regions.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const upper = project.floors[1]
  const roofs = resolveBuildingRoofs(project.floors).map(({ roof, resolved, floorId }) => {
    const b = getRoofSupportBoundsInRoofSpace(roof)
    return { roofId: roof.id, floorId, surfaceFaces: resolved.structuralFaces,
      undersideFaces: getRoofCoverageUndersideFaces(resolved),
      supportPolygon: (roof.type === 'bay' ? getBaySupportPolygon(roof) :
        [{ x:b.minX,y:b.minY },{ x:b.maxX,y:b.minY },{ x:b.maxX,y:b.maxY },{ x:b.minX,y:b.maxY }])
        .map(p => getRoofWorldPointFromLocal(roof, p)),
    }
  })
  // Whole-wall clipping exemptions must not control local material division,
  // including when room detection sees occupied space beside the wall.
  const options = createWallRoofClipOptions({ floorElevation: upper.elevation,
    floorId: upper.id, walls: upper.walls, roofs, isInsideRoom: () => true })
  const wallId = 'feb38193-7550-40b8-9dfb-663aa593a6df'
  const bayId = project.floors[0].roofs!.find(r => r.type === 'bay')!.id
  assert.ok(options.surfaceDividers.filter(d => d.wallId === wallId && d.id.startsWith(bayId)).length >= 2)
  assert.ok(options.surfaceDividers.some(d => d.wallId === '3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e'))
  const doorwayId = '3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e'
  const mainRoof = roofs.find(r => r.roofId.startsWith('b490'))!
  const doorwayDividers = options.surfaceDividers.filter(d => d.wallId === doorwayId && d.id.startsWith(mainRoof.roofId))
  assert.equal(doorwayDividers.length, 2)
  assert.ok(doorwayDividers.every(d => d.normal[0] > 0.99), 'the room side must not inherit exterior roof lines')
  const legacyDividers = createWallRoofSurfaceDividers(mainRoof.roofId, mainRoof.surfaceFaces,
    upper.walls.filter(w => w.id === doorwayId), upper.elevation)
  assert.deepEqual(doorwayDividers, legacyDividers.filter(d => d.normal[0] > 0.99), 'saved exterior region IDs are preserved')
  const facade: WallMeshFace = { ...face, faceId: 'red-front', wallId,
    normal: [0, 0, 1], pickSource: { wallId, side: -1 },
    vertices: [[-1.87,0,7.984318178330288],[1.35,0,7.984318178330288],
      [1.35,2.4,7.984318178330288],[-1.87,2.4,7.984318178330288]]
      .map(position => ({ position, uv: [position[0],position[1]+upper.elevation] })) as WallMeshFace['vertices'],
  }
  const divided = partitionWallFacesAtRoofs([facade], options.surfaceDividers, upper.elevation)
  assert.ok(divided.some(f => f.roofSurfaceRegion === 'roof-exposed'))
  assert.ok(divided.some(f => f.roofSurfaceRegion?.includes(':below')))
  const groups = buildCoplanarWallSurfaceGroups(divided)
  const belowIds = new Set(divided.filter(f => f.roofSurfaceRegion !== 'roof-exposed').map(f => f.faceId))
  for (const f of divided.filter(f => f.roofSurfaceRegion === 'roof-exposed')) {
    assert.ok(groups.get(f.faceId)!.every(ref => !belowIds.has(ref.fragmentId)))
  }
  const interior = { ...facade, faceId: 'room-face', roomSignature: 'upstairs-room' }
  assert.deepEqual(partitionWallFacesAtRoofs([interior], options.surfaceDividers, upper.elevation), [interior])
})
