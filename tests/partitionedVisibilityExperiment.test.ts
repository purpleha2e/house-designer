import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Scene} from 'three'
import {snapshotIndirectGeometry} from '../src/indirectVisibility.ts'
import {runPartitionedVisibilityExperiment} from './partitionedVisibilityExperiment.ts'
test('partitioned prototype matches whole-scene segments through thin, mirrored and removed geometry',()=>{
 const scene=new Scene(),material=new MeshStandardMaterial(),wallGeometry=new BoxGeometry(.003,3,4),wall=new Mesh(wallGeometry,material),furnitureGeometry=new BoxGeometry(.5,.7,.6),instances=new InstancedMesh(furnitureGeometry,material,2)
 wall.position.set(1,1.5,0);instances.setMatrixAt(0,new Matrix4().makeTranslation(0,.5,0));instances.setMatrixAt(1,new Matrix4().makeScale(-1,1,1).setPosition(2,.5,1));scene.add(wall,instances)
 try{let before=snapshotIndirectGeometry(scene);for(const edit of ['move','remove','restore']){if(edit==='move')wall.position.x+=.1;else if(edit==='remove')scene.remove(wall);else scene.add(wall);const after=snapshotIndirectGeometry(scene),r=runPartitionedVisibilityExperiment(before,after,4096);assert.equal(r.mismatches,0);assert.ok(r.maxDistanceError<1e-6);before=after}}finally{wallGeometry.dispose();furnitureGeometry.dispose();material.dispose()}
})
