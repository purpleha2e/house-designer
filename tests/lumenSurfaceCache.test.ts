import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLumenCache, createLumenGeometry } from '../src/lumenSurfaceCache.ts'
import type { ReferenceSceneData } from '../src/diffuseSceneMaterials.ts'
import { simplifyLightingDetail } from '../src/lumenDetail.ts'
import { Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Vector3, type WebGLRenderer } from 'three'
import { DiffuseSnapshotChanged, snapshotReferenceScene } from '../src/diffuseSceneSnapshot.ts'
import { measureLumenGlazing } from '../src/lumenGlazing.ts'
import { buildLumenDistanceField } from '../src/lumenDistanceField.ts'
import { fitLumenRegion } from '../src/lumenRegion.ts'

test('only a building that fits the existing grid gets a stable cache centre',()=>{
  assert.deepEqual(fitLumenRegion([-1,0,1],[8,2.4,9.8]),[3.5,1.2,5.4])
  assert.equal(fitLumenRegion([-1,0,1],[12,2.4,9.8]),undefined)
  assert.equal(fitLumenRegion([-1,0,1],[8,6,9.8]),undefined)
})

test('the distance field preserves the sides and metric distance of a thin aperture surface', () => {
  const data = {
    positions: new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,-1,0, 1,1,0, -1,1,0]),
    uvs: new Float32Array(12), materialIndices: new Uint16Array(2),
  } as ReferenceSceneData
  const geometry = createLumenGeometry(data)
  try {
    const {values} = buildLumenDistanceField(geometry.tree, [-.25,-.25,-1], [1,1,4], .5)
    assert.deepEqual([...values], [-.75,-.25,.25,.75])
    assert.equal(buildLumenDistanceField(geometry.tree, [30,30,30], [1,1,1], .5).values[0], 6)
  } finally { geometry.dispose() }
})

test('aperture daylight respects the authored opacity across a partly open window',()=>{
  const scene=new Scene(),geometry=new PlaneGeometry(1,2),material=new MeshStandardMaterial({name:'Window glass',transparent:true,opacity:.32})
  const pane=new Mesh(geometry,material)
  pane.position.set(-.5,1,0);scene.add(pane)
  const opening={center:[0,1,0],u:[1,0,0],width:2,height:2}
  try{
    assert.ok(Math.abs(measureLumenGlazing(scene,[opening])[0].transmission!-.84)<.00001)
    pane.position.z=.7
    assert.equal(measureLumenGlazing(scene,[opening])[0].transmission,1)
    pane.position.z=0;pane.visible=false
    assert.equal(measureLumenGlazing(scene,[opening])[0].transmission,1)
  }finally{geometry.dispose();material.dispose()}
})

test('a wall resized during detail preparation retries with the new geometry and material groups',async()=>{
  const scene=new Scene(),old=new PlaneGeometry(2,1,40,16),replacement=new PlaneGeometry(3,1)
  const materials=[new MeshStandardMaterial({color:0xff0000}),new MeshStandardMaterial({color:0x0000ff})]
  const mesh=new Mesh(old,materials),half=old.index!.count/2
  old.addGroup(0,half,0);old.addGroup(half,half,1);replacement.addGroup(0,replacement.index!.count,1)
  scene.add(mesh)
  scene.userData.getIndirectUniforms=()=>({hdSkyRadianceBase:{value:new Vector3()},hdSkyDisplaySunIrradiance:{value:new Vector3()},hdSkyMode:{value:0}})
  const options={interactive:{textureCache:new WeakMap(),visitMesh:()=>{},detailIndices:async()=>{mesh.geometry=replacement;return null}}}
  const input={scene,gl:{} as WebGLRenderer} // The fixture materials have no texture readbacks.
  try{
    await assert.rejects(snapshotReferenceScene(input,undefined,options),DiffuseSnapshotChanged)
    const next=await snapshotReferenceScene(input,undefined,options)
    assert.equal(next.triangles,2);assert.deepEqual(next.data.materials.map(m=>m.color),[[0,0,1]])
  }finally{old.dispose();replacement.dispose();materials.forEach(m=>m.dispose())}
})

test('dense lighting meshes retain the silhouette and material-group borders within a bounded error',async()=>{
  const mesh=new PlaneGeometry(.18,.06,40,16),vertices=mesh.attributes.position.array as Float32Array
  const meshIndex=mesh.index!.array as Uint16Array
  const original=meshIndex.slice()
  try{
    const indices=await simplifyLightingDetail({positions:vertices,index:meshIndex,uvChannels:[mesh.attributes.uv.array as Float32Array],start:0,count:meshIndex.length,error:.003})
    assert.ok(indices && indices.length<original.length*.5)
    const retained=new Set(indices)
    for(let i=0;i<vertices.length;i+=3){
      if(Math.abs(vertices[i])>.08999 || Math.abs(vertices[i+1])>.02999)assert.ok(retained.has(i/3),'lost a silhouette vertex')
    }
    assert.deepEqual(meshIndex,original)
    assert.equal(await simplifyLightingDetail({positions:vertices,index:meshIndex,uvChannels:[],start:0,count:36,error:.003}),null)
  }finally{mesh.dispose()}
})

test('a narrow reveal and a differently oriented wall retain separate support in a shared cell',()=>{
  const origin=[0,0,0],spacing=.12
  const vertices=[.01,.02,.01,.011,.02,.01,.01,.02,.115, .02,.003,.01,.02,.1,.01,.02,.003,.11]
  const data:ReferenceSceneData={positions:Float32Array.from(vertices),uvs:new Float32Array(12),materialIndices:new Uint16Array([0,1]),
    sourceIds:new Uint32Array([8,9]),materials:[1,.2].map(x=>({color:[x,x,x],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001})),
    textures:[],sunDirection:[0,1,0],sunIrradiance:[1,1,1],skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',daylightGain:1,lights:[]}
  const cache=buildLumenCache(data,origin,spacing,true)
  try{
    const a=cache.atlas
    assert.equal(cache.accounting?.occupied,1);assert.equal(a.count,2)
    const head=a.cells.find(v=>v>0)!-1,tail=a.albedo[head*4+3]-1
    assert.ok(tail>=0);assert.equal(a.albedo[tail*4+3],0)
    assert.notEqual(a.positions[head*4+3],a.positions[tail*4+3])
  }finally{cache.dispose()}
})

test('the cache retains reflected sunlight, shadow boundaries and authored diffuse albedo between edits', () => {
  // A red floor with an opaque slab casting a shadow on its positive-x half.
  const quad=(x0:number,x1:number,y:number)=>[x0,y,-1,x0,y,1,x1,y,1, x0,y,-1,x1,y,1,x1,y,-1]
  const positions=new Float32Array([...quad(-1,1,0),...quad(0,1,.7)])
  const surface={color:[.8,.2,.1] as [number,number,number],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001}
  const data:ReferenceSceneData={positions,uvs:new Float32Array(24),materialIndices:new Uint16Array(4),
    materials:[surface],textures:[],sourceCategories:new Uint8Array([2,2,0,0]),sunDirection:[0,1,0],sunIrradiance:[1,1,1],
    skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',daylightGain:1,lights:[]}
  const cache=buildLumenCache(data,[0,1,0])
  try {
    const {atlas}=cache
    const find=(x:number)=>Array.from({length:atlas.count},(_,i)=>i).find(i=>atlas.normals[4*i+3]===2
      && Math.abs(atlas.positions[i*4]-x)<.1 && Math.abs(atlas.positions[i*4+2])<.1)!
    const sunlit=find(-.5),shadowed=find(.5)
    assert.ok(Number.isInteger(sunlit)&&Number.isInteger(shadowed))
    const first=cache.light([0,1,0],[2,2,2])
    assert.ok(Math.abs(first.radiance[sunlit*4]-.8*2/Math.PI)<1e-6)
    assert.equal(first.radiance[shadowed*4],0)
    const dim=cache.light([0,1,0],[1,1,1])
    assert.equal(dim.radiance[sunlit*4],first.radiance[sunlit*4]/2)
    const metal={...data,materials:[{...surface,metalness:1}]}
    assert.ok(cache.updateMaterials(metal))
    assert.equal(cache.light([0,1,0],[1,1,1]).radiance[sunlit*4],0)
    assert.equal(cache.updateMaterials({...data,positions:data.positions.slice(0,18)}),false)
  } finally {cache.dispose()}
})
