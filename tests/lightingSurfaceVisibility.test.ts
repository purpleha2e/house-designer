import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three'
import {registerViewportSurfaceVisibility} from '../src/viewportSurfaceVisibility.ts'
import {createIndirectVisibility,snapshotIndirectGeometry} from '../src/indirectVisibility.ts'
import {createIndirectCaptureScene} from '../src/indirectCaptureScene.ts'

test('camera-hidden upper-floor caps remain physical BVH occluders',()=>{
 const scene=new Scene(),geometry=new BoxGeometry(4,.1,4),material=new MeshStandardMaterial(),floor=new Mesh(geometry,material)
 floor.position.y=2.7;material.visible=false;scene.add(floor)
 const release=registerViewportSurfaceVisibility(material,p=>p.y>2.75)
 const visibility=createIndirectVisibility(scene)
 try{assert.ok(visibility.distance(new Vector3(0,3,0),new Vector3(0,-1,0),4)<1,'downward light ray must hit the existing floor cap even when hidden for navigation');assert.equal(material.visible,false)}
 finally{release();visibility.dispose();geometry.dispose();material.dispose()}
})
test('capture copies include registered hidden surfaces without unhiding the editor',()=>{
 const scene=new Scene(),group=new Group(),geometry=new BoxGeometry(),material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material)
 group.visible=false;material.visible=false;group.add(mesh);scene.add(group)
 const releases=[registerViewportSurfaceVisibility(group,()=>false),registerViewportSurfaceVisibility(material,()=>false)],capture=createIndirectCaptureScene(scene,false)
 try{assert.equal(capture.sourceMeshes,1);let visible=0;capture.scene.traverseVisible(o=>{if(o instanceof Mesh&&(o.material as MeshStandardMaterial).visible)visible++});assert.ok(visible>0);assert.equal(group.visible,false);assert.equal(material.visible,false)}
 finally{capture.dispose();releases.forEach(r=>r());geometry.dispose();material.dispose()}
})
test('physical snapshots are invariant under registered camera visibility but exclude genuinely hidden geometry',()=>{
 const scene=new Scene(),geometry=new BoxGeometry(),material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material),hidden=new Mesh(geometry,new MeshStandardMaterial())
 hidden.visible=false;scene.add(mesh,hidden);const release=registerViewportSurfaceVisibility(material,()=>true)
 try{const before=snapshotIndirectGeometry(scene);material.visible=false;const after=snapshotIndirectGeometry(scene);assert.equal(before.length,1);assert.deepEqual(after,before)}
 finally{release();geometry.dispose();material.dispose();(hidden.material as MeshStandardMaterial).dispose()}
})
