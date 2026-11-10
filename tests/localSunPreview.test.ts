import test from 'node:test'
import assert from 'node:assert/strict'
import {Data3DTexture,DataUtils,FloatType,HalfFloatType,Matrix4,Vector3} from 'three'
import {packLocalSunPreview,traceLocalSunPrimary} from '../src/localSunPreview.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'

test('screen preview packing preserves original coefficients and stores RGB, depth, normals and support separately',()=>{
 const data=Uint16Array.from({length:2*3*2*4},(_,i)=>DataUtils.toHalfFloat(i/100)),original=new Uint16Array(data),source=new Data3DTexture(data,2,3,2);source.type=HalfFloatType
 const image=new Float32Array([.1,.2,.3,2.75,0,0,0,3.25]),normals=new Float32Array([0,1,0,1,1,0,0,0]),packed=packLocalSunPreview(source,image,normals)
 try{
  const out=packed.texture.image.data as Uint16Array,start=packed.layout.z*4
  assert.deepEqual(data,original);assert.deepEqual(out.subarray(0,data.length),original)
  assert.deepEqual(out.subarray(data.length,data.length+24),data.subarray(24),'guard slice duplicates the original upper edge')
  assert.deepEqual(out.subarray(start,start+8),Uint16Array.from(image,DataUtils.toHalfFloat))
  assert.deepEqual(out.subarray(start+8,start+16),Uint16Array.from(normals,DataUtils.toHalfFloat))
 }finally{source.dispose();packed.texture.dispose()}
})
test('Z scaling retains trilinear volume samples including the clamped upper boundary',()=>{
 const source=new Data3DTexture(Uint16Array.from([0,0,0,0,DataUtils.toHalfFloat(1),0,0,0]),1,1,2);source.type=HalfFloatType
 const p=packLocalSunPreview(source,new Float32Array([3,2,1,4]),new Float32Array([0,1,0,1]))
 const interpolate=(data:Uint16Array,depth:number,z:number)=>{const i=z*depth-.5,a=Math.max(0,Math.min(depth-1,Math.floor(i))),b=Math.max(0,Math.min(depth-1,Math.floor(i)+1)),t=i-Math.floor(i);return DataUtils.fromHalfFloat(data[a*4])*(1-t)+DataUtils.fromHalfFloat(data[b*4])*t}
 try{for(const z of [0,.01,.25,.5,.75,.99,1])assert.ok(Math.abs(interpolate(source.image.data as Uint16Array,2,z)-interpolate(p.texture.image.data as Uint16Array,p.texture.image.depth,z*p.scale))<1e-12)}finally{source.dispose();p.texture.dispose()}
})
test('unsupported texture storage is rejected before a display texture can be published',()=>{
 const source=new Data3DTexture(new Float32Array(4),1,1,1);source.type=FloatType
 try{assert.throws(()=>packLocalSunPreview(source,new Float32Array(4),new Float32Array(4)),/Unsupported/)}finally{source.dispose()}
})
test('camera-hidden surfaces are skipped only by primary rays and visibility updates reuse the physical BVH',()=>{
 const positions=new Float32Array([.5,-1,-1,.5,-1,1,.5,1,1,1,-1,-1,1,-1,1,1,1,1])
 const query=createIndirectVisibilityFromSnapshot([{position:positions,stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:6}],matrices:[new Matrix4().toArray()],structural:true}])
 const origin=new Vector3(0,0,0),direction=new Vector3(1,0,0)
 try{
  const physical=query.hit(origin,direction)!,visible=traceLocalSunPrimary(query,origin,direction,new Uint8Array([0,1]))!
  assert.equal(physical.point.x,.5);assert.equal(visible.point.x,1)
  assert.equal(query.hit(new Vector3(.9,0,0),new Vector3(-1,0,0))!.point.x,.5,'the hidden surface still blocks reflected sunlight')
  assert.equal(traceLocalSunPrimary(query,origin,direction,new Uint8Array([1,0]))!.point.x,.5)
 }finally{query.dispose()}
})
