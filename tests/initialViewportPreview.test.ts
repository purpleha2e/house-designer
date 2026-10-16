import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import { prepareInitialViewportPreview } from '../src/initialViewportPreview.ts'

test('cold-load preview compiles one instanced outline material without touching live resources',async()=>{
  const source=new Scene(),geometry=new BoxGeometry(),material=new MeshBasicMaterial()
  const model=new Group();model.name='model-transform-example';model.position.x=3
  model.add(new Mesh(geometry,material));source.add(model,new Mesh(geometry,material))
  const shadowMap={enabled:true}
  const renderer={shadowMap,compileAsync:async(scene:Scene)=>{assert.equal(shadowMap.enabled,false);return scene}} as unknown as WebGLRenderer
  const preview=await prepareInitialViewportPreview(source,renderer,new PerspectiveCamera(),()=>false)
  assert.ok(preview)
  assert.equal(preview.scene.children.length,1)
  const mesh=preview.scene.children[0] as InstancedMesh
  assert.equal(mesh.count,2)
  assert.equal((mesh.material as MeshBasicMaterial).wireframe,true)
  assert.equal(material.wireframe,false)
  assert.equal(shadowMap.enabled,true)
  let sourceDisposed=false;geometry.addEventListener('dispose',()=>{sourceDisposed=true})
  preview.dispose();assert.equal(sourceDisposed,false)
  assert.equal(await prepareInitialViewportPreview(source,renderer,new PerspectiveCamera(),()=>true),undefined)
  geometry.dispose();material.dispose()
})
