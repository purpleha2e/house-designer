import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,MeshBasicMaterial,Scene,Matrix4,Vector3,Quaternion,Euler,Group} from 'three'
import {createIndirectVisibility,snapshotIndirectGeometry} from '../src/indirectVisibility.ts'
import {NextAcceleration} from './giNextAcceleration.ts'

test('reusable BLAS matches flat BVH across transforms and incremental topology',()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(.006,2,3),wall=new Mesh(geometry,material),bvh=new NextAcceleration()
  scene.add(wall);const part=snapshotIndirectGeometry(scene)[0];bvh.setGeometry('wall','1',part)
  const transforms=[new Matrix4(),new Matrix4().compose(new Vector3(1,2,3),new Quaternion().setFromEuler(new Euler(.3,.7,-.4)),new Vector3(-2,.5,1.7))]
  let state=72;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)+.5)/4294967296
  try{for(const matrix of transforms){wall.matrixAutoUpdate=false;wall.matrix.copy(matrix);bvh.setInstance('wall','wall',matrix);const reference=createIndirectVisibility(scene)
    try{for(let j=0;j<3000;j++){const origin=new Vector3(random()*8-3,random()*8-3,random()*8-3),direction=new Vector3(random()-.5,random()-.5,random()-.5).normalize(),expected=reference.hit(origin,direction,20,.0001),actual=bvh.hit(origin,direction,20,.0001);assert.equal(!!actual,!!expected);if(actual&&expected){assert.ok(Math.abs(actual.distance-expected.distance)<2e-5);assert.equal(actual.face,Math.floor(expected.face!.a/3));assert.ok(actual.normal.dot(expected.face!.normal)>.999)}}}finally{reference.dispose()}}
    assert.equal(bvh.builds,1);assert.ok(bvh.refits>0)
    bvh.setInstance('chair-copy','wall',new Matrix4().makeTranslation(10,0,0));assert.equal(bvh.builds,1)
    bvh.removeInstance('wall');assert.equal(bvh.hit(new Vector3(-2,0,0),new Vector3(1,0,0),4),null)
    bvh.setGeometry('wall','2',{...part,position:new Float32Array(Array.from(part.position,v=>v*2))});assert.equal(bvh.builds,2)
    assert.throws(()=>bvh.setInstance('invalid','wall',new Matrix4().makeScale(0,1,1)),/Singular/)
    bvh.removeInstance('chair-copy');bvh.removeUnusedGeometry();assert.equal(bvh.memory().uniqueGeometries,0)
  }finally{bvh.dispose();geometry.dispose();material.dispose()}
})

test('architectural chunks, shared chairs, child transforms and material coverage stay incremental',()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),glass=new MeshPhysicalMaterial({transmission:1}),shadowOnly=new MeshBasicMaterial(),box=new BoxGeometry(1,1,1),bvh=new NextAcceleration(),objects=new Map<string,Mesh>(),parent=new Group()
  parent.position.set(3,0,2);parent.rotation.y=.4;scene.add(parent)
  const add=(id:string,position:number[],scale:number[],owner:Scene|Group=scene)=>{const mesh:Mesh=new Mesh(box,material);mesh.position.fromArray(position);mesh.scale.fromArray(scale);owner.add(mesh);objects.set(id,mesh);return mesh}
  add('wall',[0,1.5,0],[.1,3,4]);add('slab',[0,3,0],[5,.15,4]);add('chair1',[1,.4,1],[.5,.8,.5],parent);add('chair2',[-1,.4,1],[.5,.8,.5],parent)
  const glazing=add('glazing',[2,1,0],[.006,2,2]);glazing.material=glass
  const shadow=add('shadow',[1,1,0],[.1,2,2]);shadow.material=shadowOnly
  const parts=snapshotIndirectGeometry(scene);assert.equal(parts.length,4)
  bvh.setGeometry('shared-box','1',snapshotIndirectGeometry(objects.get('wall')!)[0])
  const sync=()=>{scene.updateMatrixWorld(true);for(const [id,mesh]of objects){if(mesh.parent&&snapshotIndirectGeometry(mesh).length)bvh.setInstance(id,'shared-box',mesh.matrixWorld);else bvh.removeInstance(id)}}
  let seed=34;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)+.5)/4294967296
  try{for(const edit of ['initial','move-chair','add-chair','delete-chair','move-wall','add-window-opening','remove-wall','floor-opening']){
    if(edit==='move-chair')objects.get('chair1')!.position.x+=.2
    if(edit==='add-chair')add('chair3',[2,.4,1],[.5,.8,.5],parent)
    if(edit==='delete-chair')objects.get('chair2')!.removeFromParent()
    if(edit==='move-wall')objects.get('wall')!.position.x+=.2
    if(edit==='add-window-opening'){objects.get('wall')!.scale.y=.8;objects.get('wall')!.position.y=.4;add('header',[.2,2.7,0],[.1,.6,4]);add('jamb',[.2,1.5,1.5],[.1,1.4,1])}
    if(edit==='remove-wall')objects.get('wall')!.removeFromParent()
    if(edit==='floor-opening'){objects.get('slab')!.scale.x=1.5;objects.get('slab')!.position.x=-1.75;add('slab-side',[1.75,3,0],[1.5,.15,4])}
    sync();const reference=createIndirectVisibility(scene)
    try{for(let j=0;j<1500;j++){const origin=new Vector3(rand()*10-4,rand()*6-1,rand()*10-4),direction=new Vector3(rand()-.5,rand()-.5,rand()-.5).normalize();assert.equal(bvh.occluded(origin,direction,20,.0001),reference.occluded(origin,direction,20,.0001),edit)}}finally{reference.dispose()}
    assert.equal(bvh.builds,1,'all fixtures are immutable box instances; transforms never rebuild BLAS')
  }}finally{bvh.dispose();box.dispose();material.dispose();glass.dispose();shadowOnly.dispose()}
})
