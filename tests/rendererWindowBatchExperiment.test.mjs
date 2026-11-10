import test from 'node:test'
import assert from 'node:assert/strict'
import {Scene,Box3,Vector3,Raycaster} from 'three'
import {createWindowDesign} from '../src/windowDesign.ts'
import {createWindowGeometry,disposeWindowGeometry} from '../src/windowGeometry.ts'
import {snapshotIndirectGeometry} from '../src/indirectVisibility.ts'
import {isBatchedModelSource} from '../src/importedModelBatching.ts'
import {createWindowBatchExperiment} from './browser/rendererAuditWindowBatch.js'
const fixture=()=>{const scene=new Scene(),design=createWindowDesign();design.layout={kind:'pane',opening:'top'};const root=createWindowGeometry(design);root.scale.set(1.2,.8,.7);scene.add(root);const batch=createWindowBatchExperiment(root);scene.add(batch.group);return{scene,root,batch}}
test('local opaque batching preserves bounds and triangle counts with independent glass',()=>{
 const {scene,root,batch}=fixture();scene.updateMatrixWorld(true)
 const sourceBoxes=batch.batches.flatMap(b=>b.members),before=new Box3();for(const m of sourceBoxes)before.union(new Box3().setFromObject(m))
 const triangles=sourceBoxes.reduce((n,m)=>n+m.geometry.index.count/3,0),glass=root.children.filter(m=>m.material.name==='Window glass')
 batch.set(true);scene.updateMatrixWorld(true)
 const after=new Box3().setFromObject(batch.group)
 assert.ok(before.min.distanceTo(after.min)<1e-6);assert.ok(before.max.distanceTo(after.max)<1e-6)
 assert.equal(batch.batches.reduce((n,b)=>n+b.mesh.geometry.index.count/3,0),triangles)
 assert.ok(batch.batches.length<sourceBoxes.length)
 assert.ok(glass.every(m=>m.visible&&!m.castShadow&&!isBatchedModelSource(m)))
 batch.dispose();disposeWindowGeometry(root)
})
test('GI source descriptors and individual-window ray picking remain unchanged',()=>{
 const {scene,root,batch}=fixture(),before=snapshotIndirectGeometry(scene)
 const ray=new Raycaster(new Vector3(0,.6,3),new Vector3(0,0,-1)),pick=ray.intersectObject(root,true).map(h=>h.object.uuid)
 batch.set(true)
 assert.deepEqual(snapshotIndirectGeometry(scene),before)
 assert.deepEqual(ray.intersectObject(root,true).map(h=>h.object.uuid),pick)
 assert.ok(batch.batches.flatMap(b=>b.members).every(isBatchedModelSource))
 batch.set(false);assert.deepEqual(snapshotIndirectGeometry(scene),before)
 assert.ok(batch.batches.flatMap(b=>b.members).every(m=>m.visible&&!isBatchedModelSource(m)))
 batch.dispose();disposeWindowGeometry(root)
})
test('transparent, inactive and wireframe parts restore original submissions',()=>{
 const {root,batch}=fixture();batch.set(true)
 const frame=batch.batches.find(b=>b.mesh.material.name==='Window frame')
 frame.mesh.material.transparent=true;frame.mesh.material.opacity=.24;batch.set(true)
 assert.equal(frame.mesh.visible,false);assert.ok(frame.members.every(m=>m.visible&&!isBatchedModelSource(m)))
 frame.mesh.material.transparent=false;frame.mesh.material.opacity=1;frame.mesh.material.wireframe=true;batch.set(true);assert.equal(frame.mesh.visible,false)
 frame.mesh.material.wireframe=false;batch.set(true);assert.equal(frame.mesh.visible,true)
 batch.set(false);assert.ok(batch.batches.every(b=>!b.mesh.visible))
 batch.dispose();disposeWindowGeometry(root)
})
test('disposing the render batch releases its geometry without disposing shared finishes',()=>{
 const {root,batch}=fixture();let geometries=0,materials=0
 for(const b of batch.batches){b.mesh.geometry.addEventListener('dispose',()=>geometries++);b.mesh.material.addEventListener('dispose',()=>materials++)}
 batch.set(true);batch.dispose()
 assert.equal(geometries,batch.batches.length);assert.equal(materials,0);assert.equal(batch.group.parent,null)
 assert.ok(batch.batches.flatMap(b=>b.members).every(m=>!isBatchedModelSource(m)))
 disposeWindowGeometry(root)
})
