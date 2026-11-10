import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Matrix4, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three'
import { voxelizeFastGeometry } from '../src/fastGIGeometry.ts'
import { snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { fastGIRoom } from '../src/fastGI.ts'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { formatFastGIProgress } from '../src/fastGIProgress.ts'
import { setFastGIShaderFeature } from '../src/fastGIShader.ts'
import { completeShaderWarmup, shaderWarmupGeneration } from '../src/shaderWarmupState.ts'

test('fast GI status distinguishes disabled, active and refined probe display',()=>{
  assert.equal(formatFastGIProgress(false,{state:'ready'},1),'Fast GI off')
  assert.match(formatFastGIProgress(true,{state:'ready',firstVisibleMs:165},1),/Fast GI active · 100% · 165 ms/)
  assert.equal(formatFastGIProgress(true,{state:'ready'},0),'Fast GI ready · displaying probes')
  assert.match(formatFastGIProgress(true,{state:'capture'},0),/capturing/)
  assert.match(formatFastGIProgress(true,{error:'Unsupported renderer'},0),/unavailable.*Unsupported renderer/)
})

test('fast GI switches hold the display and keep retained and early lit programs frozen',()=>{
  const scene=new Scene(),geometry=new BoxGeometry(),material=new MeshStandardMaterial(),field=createIndirectField([])
  const uniforms=createIndirectUniforms(field);applyIndirectLightingShader(material,uniforms);scene.add(new Mesh(geometry,material))
  const retained=retainViewportScene(scene),opaque=createOpaqueViewportScene(scene,{lighting:true})
  const copies=[retained.scene.children.find(o=>o instanceof Mesh),opaque.scene.children.find(o=>o instanceof Mesh)].map(o=>(o as Mesh).material as MeshStandardMaterial)
  const versions=copies.map(m=>m.version)
  const keys=copies.map(m=>m.customProgramCacheKey()),generation=shaderWarmupGeneration(scene)
  assert.equal(setFastGIShaderFeature(scene,uniforms.hdFastFeature,true),true)
  assert.equal(scene.userData.shaderWarmupPending,true)
  assert.equal(completeShaderWarmup(scene,generation),false,'older warmups cannot publish the changed program')
  retained.syncLighting();opaque.syncLighting()
  copies.forEach((m,i)=>{assert.equal(m.version,versions[i]);assert.equal(m.customProgramCacheKey(),keys[i]);assert.equal(m.transparent,false)})
  const replacement=retainViewportScene(scene)
  const next=(replacement.scene.children.find(o=>o instanceof Mesh) as Mesh).material as MeshStandardMaterial
  assert.match(next.customProgramCacheKey(),/display-fast/,'replacement uses the newly prepared variant')
  const enabledGeneration=shaderWarmupGeneration(scene)
  assert.equal(setFastGIShaderFeature(scene,uniforms.hdFastFeature,true),false,'repeated frames do not restart preparation')
  assert.equal(shaderWarmupGeneration(scene),enabledGeneration)
  setFastGIShaderFeature(scene,uniforms.hdFastFeature,false)
  assert.equal(completeShaderWarmup(scene,enabledGeneration),false,'disabling during preparation requires a newer generation')
  retained.syncLighting();opaque.syncLighting()
  copies.forEach(m=>assert.doesNotMatch(m.customProgramCacheKey(),/display-fast/))
  replacement.dispose();retained.dispose();opaque.dispose();geometry.dispose();material.dispose();field.dispose()
})

test('conservative occupancy closes thin walls while retaining a window and table clearance',()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometries:BoxGeometry[]=[]
  const box=(x:number,y:number,z:number,w:number,h:number,d:number)=>{const g=new BoxGeometry(w,h,d);geometries.push(g);const mesh=new Mesh(g,material);mesh.position.set(x,y,z);scene.add(mesh)}
  box(2,2,.5,4,4,.025) // A thin partition perpendicular to z.
  box(.5,2,3,1,4,.025);box(3.5,2,3,1,4,.025) // Window jambs.
  box(2,.5,3,2,1,.025);box(2,3.5,3,2,1,.025) // Window sill/header.
  box(2,1.5,2,1.5,.1,1) // Floating tabletop.
  const parts=snapshotIndirectGeometry(scene),n=32,result=voxelizeFastGeometry(parts,[0,0,0],[4,4,4],n)
  const occupied=(x:number,y:number,z:number)=>result.data[Math.floor(x/4*n)+Math.floor(z/4*n)*n+Math.floor(y/4*n)*n*n]!==0
  assert.ok(occupied(2,2,.5),'subvoxel partition remains solid')
  assert.ok(!occupied(2,2,3),'window opening stays clear')
  assert.ok(occupied(.5,2,3),'window jamb remains solid')
  assert.ok(occupied(2,1.5,2),'tabletop is represented')
  assert.ok(!occupied(2,.5,2),'empty space under the table is not voxelized as furniture')
  const translated=parts.map(part=>({...part,matrices:part.matrices.map(m=>new Matrix4().makeTranslation(0,0,1).multiply(new Matrix4().fromArray(m)).toArray())}))
  const moved=voxelizeFastGeometry(translated,[0,0,0],[4,4,4],n)
  assert.notDeepEqual(moved.data,result.data,'world transforms participate in occupancy')
  geometries.forEach(g=>g.dispose());material.dispose()
})

test('camera navigation inside a room does not move its volume or capture anchor',()=>{
  const floors=[{id:'ground',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}]}]
  const a=fastGIRoom(floors,new Vector3(1,1,1)),b=fastGIRoom(floors,new Vector3(7,2,5))
  assert.ok(a&&b);assert.deepEqual(a.bounds,b.bounds);assert.deepEqual(a.anchor,b.anchor)
  assert.equal(fastGIRoom([],new Vector3()),null)
})

test('doorway support patches keep the owning room volume instead of creating a tiny lighting cell', () => {
  const polygon=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]
  const floors=[{id:'floor',elevation:0,height:3,rooms:[{signature:'room',polygon},
    {signature:'room',polygon:[{x:4,y:1},{x:4.4,y:1},{x:4.4,y:2},{x:4,y:2}]}]}]
  const room=fastGIRoom(floors,new Vector3(4.2,1.5,1.5))!
  assert.equal(room.key,'floor:room')
  assert.ok(room.bounds.getSize(new Vector3()).x>4)
  assert.ok(room.anchor.x<4)
})
