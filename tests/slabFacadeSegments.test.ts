import assert from 'node:assert/strict'
import test from 'node:test'
import { splitSlabFacadeEdge } from '../src/slabFacadeSegments.ts'
import { findWallFragmentAssignmentForFace } from '../src/wallFragmentAssignments.ts'
import { createWallSurfaceGeometryStore } from '../src/wallEngine/wallSurfaceGeometryStore.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import type { SurfaceMaterialAssignment } from '../src/types.ts'

function face(id: string, start: number, end: number): WallMeshFace {
  return { faceId:id,wallId:'wall',kind:'side',normal:[0,0,1],
    materialSource:{wallId:'wall',side:1},pickSource:{wallId:'wall',side:1},uvSource:{wallId:'wall',side:1},
    vertices:[[start,0,0],[end,0,0],[end,2.4,0],[start,2.4,0]].map(position=>({position,uv:[position[0],position[1]]})) as WallMeshFace['vertices'] }
}
const edge={point:{x:0,y:0},nextPoint:{x:2,y:0},lowerHeight:2.399,upperHeight:0.001}

test('slab facade follows individual wall fragments instead of the latest wall finish',()=>{
  const a=face('a',0,1),b=face('b',1,2)
  const parts=splitSlabFacadeEdge({...edge,lowerFaces:[a,b],upperFaces:[]})
  assert.deepEqual(parts.map(p=>[p.point.x,p.nextPoint.x,p.lowerFace?.faceId]),[[0,1,'a'],[1,2,'b']])
  const assignment:SurfaceMaterialAssignment={id:'paint-a',materialId:'green',target:{type:'wall-surface-fragment',wallId:'wall',side:1,fragmentId:'a'}}
  assert.equal(findWallFragmentAssignmentForFace([assignment],parts[0].lowerFace!),assignment)
  assert.equal(findWallFragmentAssignmentForFace([assignment],parts[1].lowerFace!),undefined)
})

test('upper and lower facade boundaries are combined without gaps or invented support',()=>{
  const parts=splitSlabFacadeEdge({...edge,lowerFaces:[face('lower',0,0.5)],upperFaces:[face('upper-left',0,1),face('upper-right',1,1.5)]})
  assert.deepEqual(parts.map(p=>[p.point.x,p.nextPoint.x,p.lowerFace?.faceId,p.upperFace?.faceId]),
    [[0,0.5,'lower','upper-left'],[0.5,1,undefined,'upper-left'],[1,1.5,undefined,'upper-right'],[1.5,2,undefined,undefined]])
})

test('roof-cut faces contribute only where they physically meet the slab',()=>{
  const triangle=face('roof:roof-region:/roof:above',0,2)
  triangle.vertices=[triangle.vertices[0],triangle.vertices[2],triangle.vertices[3],triangle.vertices[3]]
  const inside={...face('interior',0,2),roomSignature:'room'}
  inside.vertices=inside.vertices.map(v=>({...v,position:[v.position[0],v.position[1],-0.3]})) as WallMeshFace['vertices']
  const unrelated=face('distant',0,2)
  unrelated.vertices=unrelated.vertices.map(v=>({...v,position:[v.position[0],v.position[1],1]})) as WallMeshFace['vertices']
  const parts=splitSlabFacadeEdge({...edge,upperHeight:1.2,lowerFaces:[],upperFaces:[triangle,inside,unrelated]})
  assert.deepEqual(parts.map(p=>[p.point.x,p.nextPoint.x,p.upperFace?.faceId]),[[0,1,triangle.faceId],[1,2,undefined]])
})

test('completed wall geometry is scoped to its view and stale cleanup cannot remove a newer result',()=>{
  const store=createWallSurfaceGeometryStore(),other=createWallSurfaceGeometryStore()
  let notifications=0;const unsubscribe=store.subscribe(()=>notifications++)
  const first=[face('old',0,2)],second=[face('new',0,2)]
  const removeFirst=store.publish('floor',first),removeSecond=store.publish('floor',second)
  removeFirst()
  assert.equal(store.get('floor'),second)
  assert.equal(other.get('floor').length,0)
  assert.equal(notifications,2)
  removeSecond();assert.equal(store.get('floor').length,0)
  unsubscribe();store.publish('floor',first);assert.equal(notifications,3)
})
