import test from 'node:test'
import assert from 'node:assert/strict'
import {Matrix4,Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {gatherLocalIndirect} from './localFinalGather.ts'
import {createDirectSunRadiance,createSunHitMaterials,createSunSurfaceQuery,sampleSunTexture,srgbToLinear,type SunMaterial,type SunMetadata} from './firstBounceSun.ts'
const matrix=[1,0,0,0,1,0,0,0,1],identity={geometry:1,lighting:1,source:'surface-sun',bounces:1}
const material=(extra:Partial<SunMaterial>={}):SunMaterial=>({color:[.5,.5,.5],metalness:0,map:-1,matrix,wrapS:1001,wrapT:1001,side:2,opacity:1,...extra})
function fixture(positions:number[],uvs?:number[],materials=[material()],indices?:number[]){
 const p=new Float32Array(positions),triangles=p.length/9,meta:SunMetadata={positions:p,uvs:new Float32Array(uvs??new Array(triangles*6).fill(0)),owners:new Uint32Array(Array.from({length:triangles},(_,i)=>100+i)),materialIndices:new Uint16Array(indices??new Array(triangles).fill(0)),materials,textures:[]}
 const visibility=createIndirectVisibilityFromSnapshot([{position:p,stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:p.length/3}],matrices:[new Matrix4().toArray()],structural:false}]),resolve=createSunHitMaterials(meta),query=createSunSurfaceQuery(visibility,resolve)
 return{meta,visibility,resolve,query,dispose:()=>visibility.dispose()}
}
const triangle=[1,0,0,1,1,0,1,0,1],plane=[1,-100,-100,1,-100,100,1,100,100,1,-100,-100,1,100,100,1,100,-100]
const ray=new Vector3(1,0,0),receiver={position:[0,0,0],normal:[1,0,0],geometricNormal:[1,0,0]}
function incoming(query:ReturnType<typeof createSunSurfaceQuery>,gain=2,sun=[-1,0,0],filter?:Parameters<typeof createDirectSunRadiance>[0]['filter']){return createDirectSunRadiance({query,sunDirection:sun,sunIrradiance:[3,2,1],daylightGain:gain,identity,filter})}
test('BVH original triangle maps to its owning object and material after index reordering',()=>{
 const positions=Array.from({length:10},(_,t)=>triangle.map((v,i)=>i%3===0?v+9-t:v)).flat(),f=fixture(positions,undefined,[material(),material({color:[.2,.3,.4]})],Array.from({length:10},(_,i)=>i%2))
 try{const h=f.visibility.hit(new Vector3(0,.25,.5),ray,80,.0001)!,m=f.resolve(h,ray);assert.notEqual(h.faceIndex,9);assert.equal(m.triangle,9);assert.equal(m.owner,109);assert.equal(m.materialId,1);assert.deepEqual(m.rho,[.2,.3,.4])}finally{f.dispose()}
})
test('barycentric coordinates and triangle UVs are evaluated at the actual hit',()=>{
 const f=fixture(triangle,[0,0,1,0,0,1])
 try{const h=f.visibility.hit(new Vector3(0,.25,.5),ray,80,.0001)!,m=f.resolve(h,ray);m.barycentric.forEach((v,i)=>assert.ok(Math.abs(v-[.25,.25,.5][i])<1e-12));assert.deepEqual(m.uv,[.25,.5]);assert.equal(m.side,-1);m.normal.toArray().forEach((v,c)=>assert.ok(Math.abs(v-[-1,0,0][c])<1e-12))}finally{f.dispose()}
})
test('sRGB texels are decoded before interpolation and linear readbacks are not decoded twice',()=>{
 const texture={width:2,height:1,colorSpace:'srgb' as const,pixel:(x:number)=>x?[1,1,1,1]:[0,0,0,1]},m=material()
 assert.equal(sampleSunTexture(texture,[.5,.5],m)[0],.5)
 assert.ok(Math.abs(srgbToLinear(.5)-.21404114048223255)<1e-12)
 assert.equal(sampleSunTexture({...texture,width:1,colorSpace:'linear-srgb',pixel:()=>[.25,.5,.75,1]},[0,0],m)[0],.25)
})
test('textured reflectance multiplies material colour and one minus metalness',()=>{
 const f=fixture(triangle,[0,0,1,0,0,1],[material({color:[.8,.6,.4],metalness:.5,map:0})]);f.meta.textures=[{width:1,height:1,colorSpace:'linear-srgb',pixel:()=>[.25,.5,1,1]}]
 try{const h=f.visibility.hit(new Vector3(0,.25,.5),ray)!,m=f.resolve(h,ray);m.rho.forEach((v,c)=>assert.ok(Math.abs(v-[.1,.15,.2][c])<1e-12))}finally{f.dispose()}
})
test('Lambertian solar radiance uses the geometric cosine and applies daylight gain exactly once',()=>{
 const f=fixture(plane)
 try{const h=f.query.hit(new Vector3(),ray)!,a=incoming(f.query),b=incoming(f.query,4),x=a.lookup(h,ray),y=b.lookup(h,ray);x.rgb.forEach((v,c)=>assert.ok(Math.abs(v-[3,2,1][c]/Math.PI)<1e-12));y.rgb.forEach((v,c)=>assert.ok(Math.abs(v-2*x.rgb[c])<1e-12));assert.deepEqual(incoming(f.query,2,[1,0,0]).lookup(h,ray).rgb,[0,0,0])}finally{f.dispose()}
})
test('cosine gather removes Lambertian PI without an additional receiver cosine',()=>{
 const f=fixture(plane)
 try{const sun=incoming(f.query),r=gatherLocalIndirect({enabled:true,receiver,rays:64,identity,visibility:f.query,lookup:sun.lookup});assert.equal(r.state,'ready');r.irradiance!.forEach((v,c)=>assert.ok(Math.abs(v-[3,2,1][c])<1e-12))}finally{f.dispose()}
})
test('front/back sides and alpha masks are rejected before selecting the next geometric hit',()=>{
 const far=triangle.map((v,i)=>i%3===0?v+1:v),f=fixture([...triangle,...far],undefined,[material({side:0}),material()],[0,1])
 try{let h=f.query.hit(new Vector3(0,.2,.2),ray)!;assert.equal(f.query.material(h,ray).triangle,1);f.meta.materials[0]=material({map:0,alphaTest:.5});f.meta.textures=[{width:1,height:1,colorSpace:'linear-srgb',pixel:()=>[1,1,1,0]}];h=f.query.hit(new Vector3(0,.2,.2),ray)!;assert.equal(f.query.material(h,ray).triangle,1)}finally{f.dispose()}
})
test('unknown material features and blended opacity remain unsupported instead of using a proxy colour',()=>{
 const f=fixture(triangle)
 try{const h=f.visibility.hit(new Vector3(0,.2,.2),ray)!;for(const m of [material({opacity:.5}),material({unsupported:'custom-shader'}),material({map:4}),material({side:undefined})]){f.meta.materials[0]=m;assert.equal(f.resolve(h,ray).valid,false)}}finally{f.dispose()}
})
test('the renderer opaque pipeline ignores unused map alpha while alpha-tested materials retain the mask',()=>{
 const f=fixture(triangle,undefined,[material({map:0,opaquePipeline:true})]);f.meta.textures=[{width:1,height:1,colorSpace:'linear-srgb',pixel:()=>[.2,.4,.6,.25]}]
 try{
  const h=f.visibility.hit(new Vector3(0,.2,.2),ray)!,m=f.resolve(h,ray)
  assert.equal(m.valid,true);assert.equal(m.alpha,1);assert.deepEqual(m.rho,[.1,.2,.3])
  f.meta.materials[0]={...f.meta.materials[0],alphaTest:.5};assert.equal(f.resolve(h,ray).reason,'discarded-side-or-alpha')
  f.meta.materials[0]={...f.meta.materials[0],opaquePipeline:false,alphaTest:0};assert.equal(f.resolve(h,ray).reason,'unsupported-blended-opacity')
 }finally{f.dispose()}
})
test('metalness maps retain their own UV transforms without changing the base-colour UV',()=>{
 const f=fixture(triangle,[0,0,0,0,0,0],[material({metalness:1,metalnessMap:0,metalnessSampling:{matrix:[1,0,0,0,1,0,.75,0,1],wrapS:1001,wrapT:1001}})])
 f.meta.textures=[{width:2,height:1,colorSpace:'linear-srgb',pixel:(x:number)=>[1,1,x,1]}]
 try{const h=f.visibility.hit(new Vector3(0,.2,.2),ray)!,m=f.resolve(h,ray);assert.deepEqual(m.uv,[0,0]);assert.deepEqual(m.rho,[0,0,0]);assert.equal(m.valid,true)}finally{f.dispose()}
})
test('thin opaque blocker occludes sunlight and source filtering cannot make it transparent',()=>{
 const block=triangle.map((v,i)=>i%3===0?v-.5:v),f=fixture([...triangle,...block])
 try{const h=f.visibility.hit(new Vector3(.9,.2,.2),ray)!,sun=incoming(f.query,2,[-1,0,0],m=>m.triangle===0),r=sun.lookup(h,ray);assert.equal(r.valid,true);assert.deepEqual(r.rgb,[0,0,0]);assert.equal(sun.stats.sunOccludedHits,1)}finally{f.dispose()}
})
test('a distinct shadow-side query blocks sunlight without changing visible hit materials',()=>{
 const block=triangle.map((v,i)=>i%3===0?v-.5:v),f=fixture([...triangle,...block],undefined,[material(),material({side:1})],[0,1])
 try{
  const h=f.query.hit(new Vector3(.9,.2,.2),ray)!,visible=incoming(f.query).lookup(h,ray)
  assert.ok(visible.rgb[0]>0,'the visible-side query discards this blocker from the sunlight direction')
  const shadowQuery=createSunSurfaceQuery(f.visibility,createSunHitMaterials({...f.meta,materials:[material(),material({side:0})]}))
  const sun=createDirectSunRadiance({query:f.query,shadowQuery,sunDirection:[-1,0,0],sunIrradiance:[3,2,1],daylightGain:2,identity})
  assert.deepEqual(sun.lookup(h,ray).rgb,[0,0,0]);assert.equal(sun.stats.sunOccludedHits,1)
  assert.equal(f.query.material(h,ray).materialId,0)
 }finally{f.dispose()}
})
test('zero sun, empty hemisphere, source filtering and cancellation cannot add sky, fill or receiver direct light',()=>{
 const f=fixture(plane)
 try{const sun=incoming(f.query,2,[-1,0,0],()=>false),r=gatherLocalIndirect({enabled:true,receiver,rays:32,identity,visibility:f.query,lookup:sun.lookup});assert.deepEqual(r.irradiance,[0,0,0]);assert.equal(sun.stats.filteredHits,32)
  const cancelled=gatherLocalIndirect({enabled:true,receiver,rays:32,identity,visibility:f.query,lookup:incoming(f.query).lookup,cancelled:()=>true});assert.equal(cancelled.irradiance,null);assert.equal(cancelled.state,'cancelled')
  const zero=createDirectSunRadiance({query:f.query,sunDirection:[-1,0,0],sunIrradiance:[0,0,0],daylightGain:3.5,identity});assert.deepEqual(gatherLocalIndirect({enabled:true,receiver,rays:32,identity,visibility:f.query,lookup:zero.lookup}).irradiance,[0,0,0])
  assert.deepEqual(gatherLocalIndirect({enabled:true,receiver,rays:32,identity,visibility:f.query,lookup:incoming(f.query,2,[1,0,0]).lookup}).irradiance,[0,0,0],'receiver-facing direct sunlight is never included as indirect')
  let stop=false;const last=gatherLocalIndirect({enabled:true,receiver,rays:1,identity,visibility:f.query,lookup:incoming(f.query).lookup,cancelled:()=>stop,observe:()=>{stop=true}});assert.equal(last.state,'cancelled');assert.equal(last.irradiance,null)
 }finally{f.dispose()}
})
test('metalness and alpha data channels stay linear and UV transforms use the actual hit coordinates',()=>{
 const f=fixture(triangle,[0,0,1,0,0,1],[material({metalness:.8,metalnessMap:0})]);f.meta.textures=[{width:1,height:1,colorSpace:'srgb',pixel:()=>[.1,.2,.5,1]}]
 try{const h=f.visibility.hit(new Vector3(0,.25,.5),ray)!,m=f.resolve(h,ray);m.rho.forEach(v=>assert.ok(Math.abs(v-.3)<1e-12))
  const texture={width:2,height:1,colorSpace:'linear-srgb' as const,pixel:(x:number)=>x?[.8,.6,.4,1]:[.2,.4,.6,1]},transformed=material({matrix:[1,0,0,0,1,0,.5,0,1],wrapS:1000})
  assert.ok(Math.abs(sampleSunTexture(texture,[.25,.5],transformed)[0]-.8)<1e-12)
 }finally{f.dispose()}
})
test('an unsupported sun blocker invalidates the sample instead of inventing transmission or shadow',()=>{
 const block=triangle.map((v,i)=>i%3===0?v-.5:v),f=fixture([...triangle,...block],undefined,[material(),material({unsupported:'unavailable-alpha'})],[0,1])
 try{const h=f.visibility.hit(new Vector3(.9,.2,.2),ray)!,sun=incoming(f.query),r=sun.lookup(h,ray);assert.equal(r.valid,false);assert.match(r.reason!,/unsupported-sun-blocker/);assert.equal(sun.stats.validHits,0);assert.equal(sun.stats.unsupportedHits,1)}finally{f.dispose()}
})
