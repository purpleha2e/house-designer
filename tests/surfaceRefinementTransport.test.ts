import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry,Matrix4,Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {createSunHitMaterials,createSunSurfaceQuery} from '../src/localSunTransport.ts'
import {createSurfaceRefinementTransport,type RefinementMaterial,type RefinementSources} from '../src/surfaceRefinementTransport.ts'
import {lightingRefinementPasses,normalizeLightingRefinement,LIGHTING_REFINEMENT} from '../src/lightingRefinement.ts'
const sources:RefinementSources={skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],lights:[]}
const receiver={position:[0,0,0],normal:[0,1,0],geometricNormal:[0,1,0]}
function enclosure(rho:number,emission:number,unsupported?:string){
 const geometry=new BoxGeometry(4,4,4).toNonIndexed(),positions=geometry.attributes.position.array as Float32Array
 const visibility=createIndirectVisibilityFromSnapshot([{position:positions,stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:positions.length/3}],matrices:[new Matrix4().toArray()],structural:true}])
 const material:RefinementMaterial={color:[rho,rho,rho],emission:[emission,emission,emission],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001,side:2,opacity:1,unsupported}
 const data={positions,uvs:new Float32Array(positions.length/3*2),materialIndices:new Uint16Array(positions.length/9),owners:new Uint32Array(positions.length/9),materials:[material],textures:[]}
 const query=createSunSurfaceQuery(visibility,createSunHitMaterials(data))
 return{query,material,data,visibility,close(){visibility.dispose();geometry.dispose()}}
}
test('diffuse enclosure has the analytic finite-bounce energy, without applying receiver albedo twice',()=>{
 const e=enclosure(.5,.2)
 try{const transport=createSurfaceRefinementTransport(e.query,e.query,sources,[e.material],[])
 for(const bounces of [1,2,4,6,8]){const result=transport.gather(receiver,128,bounces);assert.equal(result.valid,true,JSON.stringify(result));const expected=Math.PI*.2*(1-.5**bounces)/(1-.5);for(const value of result.rgb)assert.ok(Math.abs(value-expected)<1e-10,`${value} versus ${expected}`)}}finally{e.close()}
})
test('a sealed diffuse enclosure rejects external sunlight and skylight',()=>{
 const e=enclosure(.5,0)
 try{const transport=createSurfaceRefinementTransport(e.query,e.query,{...sources,skyBase:[1,1,1],sunIrradiance:[10,10,10]},[e.material],[]),result=transport.gather(receiver,64,6);assert.equal(result.valid,true);assert.deepEqual(result.rgb,[0,0,0])}finally{e.close()}
})
test('indoor lamps contribute reflected energy with linear intensity and colour',()=>{
 const e=enclosure(.5,0)
 try{const sample=(power:number)=>createSurfaceRefinementTransport(e.query,e.query,{...sources,lights:[{position:[0,0,0],color:[power,power/2,0],direction:[0,0,0],distance:0,decay:2,cone:-1,penumbra:-1}]},[e.material],[]).gather(receiver,128,6)
 const a=sample(1),b=sample(2);assert.equal(a.valid,true);assert.equal(b.valid,true);assert.ok(a.rgb[0]>0);assert.ok(Math.abs(b.rgb[0]-2*a.rgb[0])<1e-12);assert.ok(Math.abs(a.rgb[1]-.5*a.rgb[0])<1e-12);assert.equal(a.rgb[2],0)
 }finally{e.close()}
})
test('open sky agrees with its analytic cosine-weighted irradiance and progressive batches preserve the sequence',()=>{
 const e=enclosure(0,0)
 try{const empty={...e.query,hit:()=>null},transport=createSurfaceRefinementTransport(empty,empty,{...sources,skyBase:[.65,.8,1]},[e.material],[]),sample={...receiver,position:[0,0,0]}
 const result=transport.gather(sample,4096,6,123)
 for(let c=0;c<3;c++)assert.ok(Math.abs(result.rgb[c]-[.65,.8,1][c]*Math.PI*(.6+.8*2/3))<.003)
 const a=transport.gather(sample,16,6,123),b=transport.gather(sample,48,6,123,16),whole=transport.gather(sample,64,6,123)
 for(let c=0;c<3;c++)assert.ok(Math.abs((a.rgb[c]*16+b.rgb[c]*48)/64-whole.rgb[c])<1e-12)
 }finally{e.close()}
})
test('unsupported surfaces request fallback, and quality levels have bounded progressive work',()=>{
 const e=enclosure(.5,0,'transmission')
 try{const result=createSurfaceRefinementTransport(e.query,e.query,sources,[e.material],[]).gather(receiver,16,6);assert.equal(result.valid,false)}finally{e.close()}
 assert.deepEqual(lightingRefinementPasses(128),[4,16,32,64,128]);assert.equal(normalizeLightingRefinement('unknown'),'fast');assert.equal(LIGHTING_REFINEMENT.fast.rays,0)
})

test('disabled lamps do no shadow work and do not change the integrated lighting',()=>{
 const e=enclosure(.5,0),lamp={position:[0,0,0],color:[1,.5,0],direction:[0,0,0],distance:0,decay:2,cone:-1,penumbra:-1}
 try{const sample=(lights:typeof lamp[])=>createSurfaceRefinementTransport(e.query,e.query,{...sources,lights},[e.material],[]).gather(receiver,128,6)
 const active=sample([lamp]),withDisabled=sample([lamp,...Array.from({length:12},()=>({...lamp,color:[0,0,0]}))])
 assert.equal(active.valid,true);assert.ok(active.shadowRays>0);assert.deepEqual(withDisabled,active)
 assert.equal(sample([{...lamp,color:[0,0,0]}]).shadowRays,0)
 }finally{e.close()}
})

test('opaque shadow fast path avoids texture sampling while alpha and sidedness still match the full resolver',()=>{
 const e=enclosure(.5,0);let reads=0
 try{const texture={width:1,height:1,colorSpace:'linear-srgb' as const,pixel:()=>{reads++;return[1,1,1,0]}},origin=receiver.position,direction=receiver.normal
 const trace=(fast:boolean,alphaTest:number,side:0|1|2=2)=>{
 const q=createSunSurfaceQuery(e.visibility,createSunHitMaterials({...e.data,textures:[texture],materials:[{...e.material,opaquePipeline:true,map:0,alphaTest,side}]},fast))
 return q.hit(new Vector3().fromArray(origin),new Vector3().fromArray(direction))
 }
 assert.ok(trace(true,0));assert.equal(reads,0);assert.ok(trace(false,0));assert.ok(reads>0)
 assert.equal(trace(true,.5),null);assert.equal(trace(false,.5),null)
 assert.equal(trace(true,0,0),null);assert.equal(trace(false,0,0),null)
 }finally{e.close()}
})

