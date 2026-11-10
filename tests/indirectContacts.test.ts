import assert from 'node:assert/strict'
import test from 'node:test'
import {Box3,BoxGeometry,BufferGeometry,DataUtils,DoubleSide,Float32BufferAttribute,Group,Matrix3,Matrix4,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {createIndirectField,restoreIndirectField,serializeIndirectField,writeIndirectPosition,writeIndirectContactTexture} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {addIndirectContactProbes,INDIRECT_CONTACT_PROBE_BUDGET} from '../src/indirectContactProbes.ts'
import {attachIndirectReceiverSafety} from '../src/indirectReceiverSafety.ts'
import {createIndirectFloorLookup} from '../src/indirectFloorLighting.ts'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
import {selectIndirectContactLinks,snapshotIndirectContactReceivers} from '../src/indirectContactReceivers.ts'
import {addIndirectFloorCoverageProbes} from '../src/indirectFurnitureProbes.ts'
import {refineIndirectReceiverGeometry} from '../src/indirectReceiverRefinement.ts'
import {createIndirectBounceField} from '../src/indirectLivePreview.ts'
import {createIndirectUniforms,updateIndirectUniforms} from '../src/indirectLightingShader.ts'

const floors=[{id:'ground',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}]

test('contact bounce input remains frozen while live capture and display coefficients change',()=>{
 const field=createIndirectField(floors,0,1,'legacy',true);field.probes.splice(1);field.probes[0].kind='contact'
 const index=field.probes[0].index*4;field.coefficients.forEach(c=>c[index]=DataUtils.toHalfFloat(.2))
 const bounce=createIndirectBounceField(field),uniforms=createIndirectUniforms(field);uniforms.hdGIContactMode.value=1
 try{writeIndirectContactTexture(bounce);const previous=bounce.contactData.slice()
  field.coefficients.forEach(c=>c[index]=DataUtils.toHalfFloat(1));updateIndirectUniforms(uniforms,field);updateIndirectUniforms(uniforms,bounce)
  assert.deepEqual(bounce.contactData,previous,'a display publication cannot feed new radiance back into an unfinished pass')
  assert.equal(DataUtils.fromHalfFloat(field.contactData[0]),1);assert.notEqual(bounce.contactTexture,field.contactTexture)
  assert.equal(field.contactTexture.image.data,field.contactData);assert.equal(bounce.contactTexture.image.data,bounce.contactData);assert.notEqual(bounce.contactTexture.source,field.contactTexture.source)
  writeIndirectContactTexture(bounce);assert.equal(DataUtils.fromHalfFloat(bounce.contactData[0]),1,'a completed pass explicitly advances the snapshot')
 }finally{bounce.dispose();field.dispose()}
})
function pocket(scale=1){const scene=new Group(),g=new BoxGeometry(.02,1,1),m=new MeshStandardMaterial({side:DoubleSide}),a=new Mesh(g,m),b=new Mesh(g,m);a.position.set(2.47,.5,2);b.position.set(2.53,.5,2);scene.add(a,b);scene.scale.x=scale;scene.updateMatrixWorld(true);return{scene,g,m,a,b,dispose(){g.dispose();m.dispose()}}}

for(const scale of [1,1.7])test(`receiver limits stop before the opposing upholstery at world scale ${scale}`,()=>{
 const f=pocket(scale),original=f.a.geometry,release=attachIndirectReceiverSafety(f.scene),p=original.attributes.position,n=original.attributes.normal,limits=f.a.geometry.attributes.hdGIReceiverMaxBias
 try{assert.ok(limits);let checked=0;for(let i=0;i<p.count;i++)if(n.getX(i)>.9){const cap=limits.getX(i);assert.ok(cap>.02*scale&&cap<.04*scale,`${cap}`);checked++}assert.ok(checked>0);assert.notEqual(f.a.geometry,original);assert.ok(f.scene.userData.indirectReceiverSafety.bytes>0)}finally{release();assert.equal(f.a.geometry,original);f.dispose()}
})
test('an isolated convex model retains its shared geometry and unrestricted front receiver',()=>{
 const f=pocket();f.scene.remove(f.b);const original=f.a.geometry,release=attachIndirectReceiverSafety(f.scene)
 try{assert.equal(f.a.geometry,original)}finally{release();f.dispose()}
})

test('receiver clearances remain finite over a triangle with unrestricted edge vertices',()=>{
 const f=pocket();f.b.scale.set(1,.2,.2);f.b.position.set(2.53,2/3,2+1/6);f.scene.updateMatrixWorld(true)
 const release=attachIndirectReceiverSafety(f.scene)
 try{const g=f.a.geometry,normal=g.attributes.normal,caps=g.attributes.hdGIReceiverMaxBias;assert.ok(caps)
  let limitedFaces=0
  for(let i=0;i<(g.index?.count??normal.count);i+=3){const ids=[0,1,2].map(k=>g.index?.getX(i+k)??i+k),z=ids.reduce((s,id)=>s+g.attributes.position.getZ(id),0)/3;if(normal.getX(ids[0])>.9&&z>0){assert.ok(ids.every(id=>caps.getX(id)<.04));limitedFaces++}}
  for(let i=0;i<f.g.attributes.position.count;i++)for(let c=0;c<3;c++)assert.equal(g.attributes.position.getComponent(i,c),f.g.attributes.position.getComponent(i,c),'original vertices remain unchanged')
  assert.ok(limitedFaces>0,'a small opposing surface between the triangle vertices still limits the face')
 }finally{release();f.dispose()}
})
test('contact captures occupy clear air between close surfaces and share a bounded allocation',()=>{
 const f=pocket(),visibility=createIndirectVisibility(f.scene),field=createIndirectField(floors,0,1,'legacy',true)
 try{field.probes.forEach(p=>{p.position.set(.4,.6,.4);writeIndirectPosition(field.positionData,p.index,p.position)})
  const boxes=[new Box3(new Vector3(2,0,1.5),new Vector3(3,1,2.5))],added=addIndirectContactProbes(field,boxes,visibility),contacts=field.probes.filter(p=>p.kind==='contact')
  assert.ok(added>0&&added<=INDIRECT_CONTACT_PROBE_BUDGET);assert.equal(contacts.length,added)
  assert.ok(contacts.some(p=>p.position.x>2.48&&p.position.x<2.52),'the narrow air pocket has a capture')
  for(const p of contacts){const withinHeight=p.position.y>0&&p.position.y<1,withinDepth=p.position.z>1.5&&p.position.z<2.5;assert.ok(!(withinHeight&&withinDepth&&(p.position.x>2.46&&p.position.x<2.48||p.position.x>2.52&&p.position.x<2.54)),'captures stay out of both solid panels');assert.ok(p.position.y>.035)}
  const restored=restoreIndirectField(serializeIndirectField(field));assert.equal(restored.contactLighting,true);assert.equal(restored.probes.filter(p=>p.kind==='contact').length,added);restored.dispose()
 }finally{field.dispose();visibility.dispose();f.dispose()}
})
test('a contact probe does not leak through a 6 mm surface inside the legacy ray near limit',()=>{
 const field=createIndirectField(floors,0,1,'legacy',true),scene=new Group(),g=new BoxGeometry(.006,2,3),m=new MeshStandardMaterial(),wall=new Mesh(g,m);wall.position.set(2.51,1,2);scene.add(wall);scene.updateMatrixWorld(true)
 field.probes.splice(1);const probe=field.probes[0];probe.kind='contact';probe.position.set(2.5,.2,2);writeIndirectPosition(field.positionData,probe.index,probe.position);field.coefficients.forEach(c=>c[probe.index*4]=DataUtils.toHalfFloat(1))
 const visibility=createIndirectVisibility(scene),result=new Float64Array(12)
 try{assert.equal(sampleIndirectCoefficients(field,0,2.52,.2,2,result,visibility),0);assert.ok(result.every(v=>v===0))}finally{field.dispose();visibility.dispose();g.dispose();m.dispose()}
})
test('contact radiance weighting preserves measured black and agrees with sparse GPU graph support',()=>{
 const field=createIndirectField(floors,0,1,'legacy',true),scene=new Group(),visibility=createIndirectVisibility(scene);field.probes.splice(2);field.positionData.fill(0)
 const n=field.floorLayer.n,step=field.bounds.size/(n-1),ix=Math.round((2.5-field.bounds.minX)/step),iz=Math.round((2-field.bounds.minZ)/step),x=field.bounds.minX+ix*step,z=field.bounds.minZ+iz*step,voxel=iz*n+ix
 field.probes.forEach((p,i)=>{p.kind=i?'contact':undefined;p.position.set(i?x:x-1,.08,z);writeIndirectPosition(field.positionData,p.index,p.position);field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat(i?0:1))})
 try{const lookup=createIndirectFloorLookup(field,visibility),values=new Float64Array(12),support=lookup(0,x,.016,z,voxel,values),graph=lookup.graph();assert.ok(values[0]>0&&values[0]<.1);assert.ok(support>1);assert.ok(graph.supportOverrides?.indices.length)
  let numerator=0,total=0,base=0;for(let i=graph.offsets[voxel];i<graph.offsets[voxel]+graph.counts[voxel];i++){numerator+=DataUtils.fromHalfFloat(field.coefficients[0][graph.indices[i]*4])*graph.weights[i];total+=graph.weights[i];const override=graph.supportOverrides!.indices.indexOf(i);base+=override>=0?graph.supportOverrides!.weights[override]:graph.weights[i]}
  assert.ok(Math.abs(numerator/total-values[0])<1e-6);assert.ok(Math.abs(base-support)<1e-6)
 }finally{field.dispose();visibility.dispose()}
})

test('surface contact links reject a closer probe across a 6 mm panel and require every face point',()=>{
 const scene=new Group(),g=new BoxGeometry(.006,2,3),m=new MeshStandardMaterial(),wall=new Mesh(g,m);wall.position.set(2.51,1,2);scene.add(wall);scene.updateMatrixWorld(true)
 const visibility=createIndirectVisibility(scene),query={probes:[[2.5,.2,2],[2.55,.2,2]],offsets:new Uint32Array([0,4]),points:new Float32Array([2.52,.2,2,2.52,.22,2,2.52,.2,2.02,2.52,.21,2.01])}
 try{assert.equal(selectIndirectContactLinks(query,visibility)[0],1,'the own-side capture supplies the face');query.points[9]=2.5;assert.equal(selectIndirectContactLinks(query,visibility)[0],-1,'a blocked face centre rejects the link')}
 finally{visibility.dispose();g.dispose();m.dispose()}
})

test('contact receiver links retain triangle identities and guard their transient layout',()=>{
 const f=pocket();f.a.scale.set(1,.5,.5);f.b.scale.set(1,.5,.5);f.scene.updateMatrixWorld(true)
 const visibility=createIndirectVisibility(f.scene),field=createIndirectField(floors,0,1,'legacy',true),release=attachIndirectReceiverSafety(f.scene)
 field.probes.splice(1);field.probes[0].kind='contact';field.probes[0].position.set(2.5,.5,2)
 try{const positions=f.a.geometry.attributes.position,index=f.a.geometry.index,snapshot=snapshotIndirectContactReceivers(f.scene,field),links=selectIndirectContactLinks(snapshot.query,visibility),stats=snapshot.install(links)
  assert.ok(stats.matched>0);assert.equal(f.a.geometry.attributes.position,positions);assert.equal(f.a.geometry.index,index);assert.ok(field.contactReceiverTag>0)
  assert.ok(!('contactReceiverTag'in serializeIndirectField(field)),'runtime bindings are rebuilt after cache restore')
  const previousTag=field.contactReceiverTag;snapshot.install(links);assert.notEqual(field.contactReceiverTag,previousTag)
 }finally{release();visibility.dispose();field.dispose();f.dispose()}
})

test('a compact contact capture cannot suppress missing floor coverage metres away',()=>{
 const scene=new Group(),visibility=createIndirectVisibility(scene),field=createIndirectField(floors,0,1,'legacy',true)
 field.probes.splice(1);const p=field.probes[0];p.kind='contact';p.position.set(.5,.18,.5);writeIndirectPosition(field.positionData,p.index,p.position)
 try{assert.ok(addIndirectFloorCoverageProbes(field,[new Box3(new Vector3(2,0,1.5),new Vector3(3,1,2.5))],visibility)>0)}finally{field.dispose();visibility.dispose()}
})

test('receiver subdivision preserves the surface, UVs and original interpolated normals under non-uniform scaling',()=>{
 const source=new BufferGeometry();source.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,.1,0],3));source.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,0,1],2))
 const normals=[new Vector3(.2,0,1).normalize(),new Vector3(-.3,.2,1).normalize(),new Vector3(.1,.5,1).normalize()];source.setAttribute('normal',new Float32BufferAttribute(normals.flatMap(n=>n.toArray()),3))
 const matrix=new Matrix4().makeScale(1.7,.7,1.3),normalMatrix=new Matrix3().getNormalMatrix(matrix),original=normals.map(n=>n.clone().applyNormalMatrix(normalMatrix)),refined=refineIndirectReceiverGeometry(source,matrix,new Map([[0,[.02,32]]]))
 try{assert.ok(refined);const g=refined.geometry;assert.ok(g.attributes.position.count>3);assert.ok(refined.bytes<=256*1024)
  for(let i=0;i<g.attributes.position.count;i++){
   const p=new Vector3().fromBufferAttribute(g.attributes.position,i),uv=g.attributes.uv,y=p.y/.1,expected=original[0].clone().multiplyScalar(1-p.x-y).addScaledVector(original[1],p.x).addScaledVector(original[2],y),actual=new Vector3().fromBufferAttribute(g.attributes.normal,i).applyMatrix3(normalMatrix)
   assert.equal(p.z,0);assert.ok(Math.abs(uv.getX(i)-p.x)<1e-6&&Math.abs(uv.getY(i)-y)<1e-6);assert.ok(expected.distanceTo(actual)<2e-6,'the fragment receives the same linear normal field')
  }
 }finally{refined?.geometry.dispose();refined?.release();source.dispose()}
})

test('refined clear fabric does not inherit the coarse face contact bound',()=>{
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,.1,0],3));g.setAttribute('normal',new Float32BufferAttribute([new Vector3(.3,0,1),new Vector3(-.3,0,1),new Vector3(0,.3,1)].flatMap(n=>n.normalize().toArray()),3))
 const material=new MeshStandardMaterial({side:DoubleSide}),mesh=new Mesh(g,material),otherGeometry=new BoxGeometry(.2,.2,.01),other=new Mesh(otherGeometry,material),root=new Group();other.position.set(1/3,.05,.04);root.add(mesh,other);root.updateMatrixWorld(true)
 const release=attachIndirectReceiverSafety(root)
 try{const p=mesh.geometry.attributes.position,caps=mesh.geometry.attributes.hdGIReceiverMaxBias;assert.ok(p.count>3,'the long curved strip is refined')
  let clear=0,contact=0;for(let i=0;i<p.count;i++){if(p.getX(i)>.8){assert.ok(caps.getX(i)>.2,'a clear end retains its unrestricted receiver');clear++}if(p.getX(i)>.25&&p.getX(i)<.4&&caps.getX(i)<.05)contact++}
  assert.ok(clear>0&&contact>0)
 }finally{release();g.dispose();otherGeometry.dispose();material.dispose()}
})
