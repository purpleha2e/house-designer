// Representative local batching experiment: opaque parts within one parametric
// window/material only. Original meshes stay authoritative for picking and GI.
// Rejected for production: local receiver-plane attributes are not rebased
// when translations are baked. See the Phase 3 counterexample and report.
import {Group,Mesh} from './rendererTestModules.ts'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {setBatchedModelSource} from '../../src/importedModelBatching.ts'
import {snapshotIndirectGeometry} from '../../src/indirectVisibility.ts'

export function createWindowBatchExperiment(root){
 const group=new Group(),batches=[],byMaterial=new Map();group.name='Window opaque render batches'
 group.position.copy(root.position);group.quaternion.copy(root.quaternion);group.scale.copy(root.scale)
 for(const source of root.children){
  const m=source.material
  if(!source.isMesh||!source.visible||Array.isArray(m)||m.transparent||m.opacity!==1||m.transmission>0)continue
  const key=[m.uuid,source.castShadow,source.receiveShadow,source.renderOrder,source.layers.mask,source.frustumCulled].join(':')
  let row=byMaterial.get(key);if(!row)byMaterial.set(key,row=[]);row.push(source)
 }
 for(const members of byMaterial.values()){
  if(members.length<2)continue
  const geometries=members.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix)})
  const geometry=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();if(!geometry)continue
  geometry.computeBoundingBox();geometry.computeBoundingSphere()
  const first=members[0],mesh=new Mesh(geometry,first.material)
  mesh.name=first.material.name+' batch';mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.renderOrder=first.renderOrder;mesh.layers.mask=first.layers.mask;mesh.frustumCulled=first.frustumCulled
  mesh.userData.houseDesignerRole='model-batch';mesh.visible=false;group.add(mesh)
  batches.push({mesh,members,enabled:false,originals:members.map(m=>m.visible)})
 }
 return{group,batches,sources:batches.reduce((n,b)=>n+b.members.length,0),set(value){
  for(const b of batches){const enabled=value&&!b.mesh.material.transparent&&b.mesh.material.opacity===1&&!b.mesh.material.wireframe;if(enabled===b.enabled)continue;b.enabled=enabled;b.mesh.visible=enabled;b.members.forEach((m,i)=>{m.visible=enabled?false:b.originals[i];setBatchedModelSource(m,enabled)})}
 },dispose(){this.set(false);group.removeFromParent();for(const b of batches)b.mesh.geometry.dispose()}}
}

export function installWindowBatchExperiment(s){
 const identities=new WeakMap();let next=0
 const id=value=>{if(!value)return null;if(!identities.has(value))identities.set(value,++next);return identities.get(value)}
 const signature=()=>JSON.stringify(snapshotIndirectGeometry(s.scene).map(p=>({position:id(p.position),index:id(p.index),ranges:p.ranges,matrices:p.matrices,stride:p.stride,offset:p.offset,normalized:p.normalized,structural:p.structural})))
 const roots=[];s.scene.traverse(o=>{if(o.name==='parametric-window')roots.push(o)})
 const batches=roots.map(root=>{const batch=createWindowBatchExperiment(root);root.parent.add(batch.group);return batch})
 return{batches,signature,windows:roots.length,sources:batches.reduce((n,b)=>n+b.sources,0),renderBatches:batches.reduce((n,b)=>n+b.batches.length,0),set(value){for(const b of batches)b.set(value)},dispose(){for(const b of batches)b.dispose()}}
}
