import assert from 'node:assert/strict'
import test from 'node:test'
import { Shape } from 'three'
import type { FloorLevel, Point } from '../src/types.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { buildStoreyGeometry, getExposedAssemblyEdges } from '../src/storeyGeometry.ts'
import { buildCoplanarWallSurfaceGroups } from '../src/wallEngine/wallSurfaceGroups.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { createCeilingSlabGeometry } from '../src/ceilingSlabGeometry.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'

const outline: Point[] = [{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}]
function floor(id: string, elevation: number): FloorLevel {
  return { id, name:id, elevation, roomHeight:2.4, slabThickness:0.3, rooms:[], models:[], walls:[] }
}
function facade(id: string, start=0, end=4, elevation=0): WallMeshFace {
  return { faceId:id, wallId:id, kind:'side', normal:[0,0,-1],
    materialSource:{wallId:id,side:-1}, pickSource:{wallId:id,side:-1}, uvSource:{wallId:id,side:-1},
    vertices:[[start,0,0],[end,0,0],[end,2.4,0],[start,2.4,0]].map(position =>
      ({position,uv:[position[0],position[1]+elevation]})) as WallMeshFace['vertices'] }
}
function build(lowerFaces=[facade('lower')], upperFaces=[facade('upper',0,4,2.7)]) {
  return buildStoreyGeometry([
    {floor:floor('ground',0),faces:lowerFaces,footprints:[outline]},
    {floor:floor('first',2.7),faces:upperFaces,footprints:[outline]},
  ])
}

test('the intermediate zone shares the lower facade identity and continuous UVs', () => {
  const source=facade('lower'), data=build([source]), ground=data.get('ground')!
  assert.equal(ground.assembly?.bottom,2.4)
  assert.equal(ground.assembly?.top,2.7)
  const band=ground.wallFaces.find(f=>f.storeyBoundary)!
  assert.equal(band.faceId,source.faceId)
  assert.deepEqual(band.materialSource,source.materialSource)
  assert.deepEqual(band.pickSource,source.pickSource)
  assert.ok(band.vertices.every(v=>v.uv[1]===v.position[1]))
  assert.equal(buildCoplanarWallSurfaceGroups(ground.wallFaces).get(source.faceId)?.length,1)
  assert.equal(data.get('first')!.wallFaces.length,1,'the upper wall must not duplicate a supported boundary')
  assert.equal(ground.assembly!.edges.filter(e=>e.wallFace).length,1)
})

test('a partial supporting wall hands the remaining boundary to the upper wall', () => {
  const data=build([facade('lower',0,2)])
  const edges=data.get('ground')!.assembly!.edges.filter(e=>e.point.y===0&&e.nextPoint.y===0)
  assert.deepEqual(edges.map(e=>[e.point.x,e.nextPoint.x,e.wallFloorId]),[[0,2,'ground'],[2,4,'first']])
  const upperBand=data.get('first')!.wallFaces.find(f=>f.storeyBoundary)!
  assert.ok(upperBand.vertices.every(v=>Math.abs(v.uv[1]-(v.position[1]+2.7))<1e-8))
  assert.ok(Math.abs(Math.min(...upperBand.vertices.map(v=>v.position[1]))+0.3)<1e-8)
})

test('an unsupported edge stays with the horizontal assembly, with no guessed wall finish', () => {
  const assembly=build([],[]).get('ground')!.assembly!
  assert.equal(getExposedAssemblyEdges(assembly,outline).length,4)
  const cut=[{x:1,y:0},{x:3,y:0},{x:3,y:2},{x:1,y:2}]
  const exposed=getExposedAssemblyEdges(assembly,cut)
  assert.deepEqual(exposed,[{point:{x:1,y:0},nextPoint:{x:3,y:0}}], 'new roof cut lines are not exterior slab sides')
})

test('bungalows and the top storey never acquire an automatic floor assembly', () => {
  const top=floor('bungalow',0), source=facade('wall')
  top.slabThickness=0.6
  const data=buildStoreyGeometry([{floor:top,faces:[source],footprints:[outline]}]).get(top.id)!
  assert.equal(data.assembly,undefined)
  assert.deepEqual(data.wallFaces,[source])
  assert.equal(build().get('first')!.assembly,undefined)
})

test('cutaway and hidden-floor views do not leave facade continuations floating above walls', () => {
  const ground=floor('ground',0), upper=floor('first',2.7)
  const data=buildStoreyGeometry([{floor:ground,faces:[facade('wall')],footprints:[outline]},
    {floor:upper,faces:[],footprints:[outline]}],new Set())
  assert.equal(data.get('ground')!.assembly,undefined)
  assert.ok(data.get('ground')!.wallFaces.every(f=>!f.storeyBoundary))
})

test('actual storey elevations bound the floor assembly and source data stays unchanged', () => {
  const ground=floor('ground',0), upper=floor('first',2.85), face=facade('wall')
  const sources=[{floor:ground,faces:[face],footprints:[outline]},{floor:upper,faces:[],footprints:[outline]}]
  const before=structuredClone(sources)
  const data=buildStoreyGeometry(sources)
  assert.equal(data.get('ground')!.assembly!.top,2.85)
  assert.deepEqual(sources,before)
})

test('roof clipping trims floor-zone walls even for a roof on the same storey', () => {
  const data=build().get('ground')!
  const clipped=runWallRoofClipJob(structuredClone(createWallRoofClipJob(data.wallFaces,{
    floorElevation:0,volumes:[{planes:[([,,z])=>z+1,([,,z])=>1-z,([,y])=>y-2.55],
      excludedWallIds:new Set(),protectedFootprints:[],clipSides:false}],
  })))
  const band=clipped.filter(f=>f.storeyBoundary)
  assert.ok(band.length>0)
  assert.ok(band.every(f=>f.vertices.every(v=>v.position[1]<=2.55+1e-8)))
  assert.ok(clipped.some(f=>!f.storeyBoundary && f.faceId==='lower'))
})

test('the horizontal top cap does not recreate an underside at the wrong roof cut', () => {
  const shape=new Shape();shape.moveTo(0,0);shape.lineTo(4,0);shape.lineTo(4,3);shape.lineTo(0,3);shape.closePath()
  const geometry=createCeilingSlabGeometry(shape,0.3,[],0,'top')
  const p=geometry.getAttribute('position')
  assert.ok(p.count>0)
  for(let i=0;i<p.count;i++) assert.ok(Math.abs(p.getZ(i)-0.3)<1e-6)
  geometry.dispose()
})

test('an internal wall below an upper facade cannot continue its interior finish into the exterior floor zone', () => {
  const lower = floor('ground',0), upper = floor('first',2.7)
  const source = { ...facade('partition'), roomSignature:'extension' }
  const data = buildStoreyGeometry([
    {floor:lower,faces:[source],footprints:[[{x:0,y:-2},{x:4,y:-2},{x:4,y:3},{x:0,y:3}]]},
    {floor:upper,faces:[facade('upper',0,4,2.7)],footprints:[outline]},
  ])
  assert.ok(data.get(lower.id)!.wallFaces.every(f=>!f.storeyBoundary))
  const band = data.get(upper.id)!.wallFaces.find(f=>f.storeyBoundary)!
  assert.equal(band.wallId,'upper')
  assert.equal(band.pickSource.wallId,'upper')
  assert.equal(band.materialSource.wallId,'upper')
})

test('a wall run crossing an extension corner changes ownership at the actual exterior boundary', () => {
  const lower = floor('ground',0), upper = floor('first',2.7)
  const data = buildStoreyGeometry([
    {floor:lower,faces:[facade('long-lower')],footprints:[[
      {x:0,y:0},{x:2,y:0},{x:2,y:-2},{x:4,y:-2},{x:4,y:3},{x:0,y:3},
    ]]},
    {floor:upper,faces:[facade('upper',0,4,2.7)],footprints:[outline]},
  ])
  const edges = data.get(lower.id)!.assembly!.edges.filter(e=>e.point.y===0&&e.nextPoint.y===0)
  assert.deepEqual(edges.map(e=>[e.point.x,e.nextPoint.x,e.wallFloorId]),[[0,2,'ground'],[2,4,'first']])
})

test('footprint matching rejects inward faces and is independent of ring winding', () => {
  const lower = floor('ground',0), upper = floor('first',2.7)
  for (const ring of [outline,[...outline].reverse()]) {
    const data = buildStoreyGeometry([
      {floor:lower,faces:[{...facade('inward'),normal:[0,0,1]}],footprints:[ring]},
      {floor:upper,faces:[facade('upper',0,4,2.7)],footprints:[ring]},
    ])
    assert.ok(data.get(lower.id)!.wallFaces.every(f=>!f.storeyBoundary))
    assert.equal(data.get(upper.id)!.wallFaces.find(f=>f.storeyBoundary)?.wallId,'upper')
  }
})

test('custom-height walls already occupying the floor zone are not overlaid', () => {
  const tall=facade('tall')
  tall.vertices=tall.vertices.map(v=>({...v,position:[v.position[0],v.position[1]===2.4?3:v.position[1],v.position[2]]})) as WallMeshFace['vertices']
  assert.ok(build([tall]).get('ground')!.wallFaces.every(f=>!f.storeyBoundary))
  const partial=facade('partial')
  partial.vertices=partial.vertices.map(v=>({...v,position:[v.position[0],v.position[1]===2.4?2.55:v.position[1],v.position[2]]})) as WallMeshFace['vertices']
  const band=build([partial]).get('ground')!.wallFaces.find(f=>f.storeyBoundary)!
  assert.equal(Math.min(...band.vertices.map(v=>v.position[1])),2.55)
})

test('a roof below an upper wall base still partitions its downward floor-zone continuation', () => {
  const upperFaces=build([], [facade('upper',0,4,2.7)]).get('first')!.wallFaces
  const options=createWallRoofClipOptions({floorElevation:2.7,floorId:'first',wallFaces:upperFaces,
    walls:[{id:'upper',start:{x:0,y:0.15},end:{x:4,y:0.15},height:2.4,thickness:0.3,kind:'external'}],
    roofs:[{roofId:'lower-roof',floorId:'ground',supportPolygon:[{x:0,y:-2},{x:4,y:-2},{x:4,y:1},{x:0,y:1}],
      undersideFaces:[],surfaceFaces:[[[0,2.45,-2],[4,2.65,-2],[4,2.65,1],[0,2.45,1]]]}]})
  assert.ok(options.surfaceDividers.length>0, 'bounds include the continuation below local height zero')
  const faces=runWallRoofClipJob(structuredClone(createWallRoofClipJob(upperFaces,options)))
  assert.ok(faces.some(f=>f.storeyBoundary&&f.roofSurfaceRegion==='roof-exposed'))
  assert.ok(faces.some(f=>f.storeyBoundary&&f.roofSurfaceRegion?.includes(':below')))
})
