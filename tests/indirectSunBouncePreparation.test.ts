import test from 'node:test'
import assert from 'node:assert/strict'
import {DirectionalLight,SphericalHarmonics3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectUniforms} from '../src/indirectLightingShader.ts'
import {prepareSunOffField} from '../src/indirectSunBouncePreparation.ts'

const floors=[{id:'ground',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]}]}]
test('source preparation performs six passes, restores the full replay atlas and preserves authoritative fields',async()=>{
  const field=createIndirectField(floors,0);field.probes=field.probes.slice(0,2)
  const coefficients=field.coefficients.map(a=>a.slice()),positions=field.positionData.slice(),volume=field.volume.data.slice(),uniforms=createIndirectUniforms(field),sun=new DirectionalLight()
  uniforms.hdSkySunIrradiance.value.set(1,2,3)
  let direct=0,replays=0,volumes=0,uploads=0
  const sh=new SphericalHarmonics3();sh.coefficients[0].set(.2,.3,.4)
  const original=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=callback=>{callback(0);return 0}
  try{
    const output=await prepareSunOffField({field,uniforms,sun,gain:3.5,passes:6,lights:[],cancelled:()=>false,display:()=>field,
      transport:{relighting:true,canRelight:()=>true,async relight(_index:number,_p:number[],_lights:unknown,source:DirectionalLight|undefined){
        if(direct++<2){assert.equal(source,undefined);assert.deepEqual(uniforms.hdSkySunIrradiance.value.toArray(),[0,0,0])}else assert.equal(source,sun)
        return sh
      },async readBatch(indices:number[],_cancel:unknown,draw:(name:string,operation:()=>void)=>void){replays++;draw('replay',()=>assert.notEqual(uniforms.hdGIVolume.value,field.volume.maps[0]));assert.equal(uniforms.hdGIVolume.value,field.volume.maps[0]);return new Map(indices.map(i=>[i,sh]))}} as never,
      client:{async volume(){volumes++;return{volume:field.volume.data.slice(),floor:field.floorLayer.data.slice()}}} as never,
      async upload(){uploads++;return true}})
    assert.ok(output);assert.equal(direct,4);assert.equal(replays,5);assert.equal(volumes,6);assert.equal(uploads,6)
    assert.deepEqual(field.coefficients,coefficients);assert.deepEqual(field.positionData,positions);assert.deepEqual(field.volume.data,volume)
    assert.deepEqual(uniforms.hdSkySunIrradiance.value.toArray(),[1,2,3]);assert.notEqual(output.coefficients,field.coefficients)
    output.dispose()
  }finally{globalThis.requestAnimationFrame=original;field.dispose()}
})
test('superseded preparation stops before transport or texture publication',async()=>{
  const field=createIndirectField(floors,0),uniforms=createIndirectUniforms(field),original=field.coefficients.map(a=>a.slice())
  let calls=0
  try{
    const output=await prepareSunOffField({field,uniforms,gain:1,passes:6,lights:[],cancelled:()=>true,display:()=>field,
      transport:{relighting:true,canRelight:()=>true,relight(){calls++;throw Error('obsolete work')}} as never,client:{} as never,async upload(){calls++;return true}})
    assert.equal(output,undefined);assert.equal(calls,0);assert.deepEqual(field.coefficients,original)
  }finally{field.dispose()}
})
test('cancelling after source removal restores every touched atlas record before releasing preparation',async()=>{
 const field=createIndirectField(floors,0);field.probes=field.probes.slice(0,2)
 const uniforms=createIndirectUniforms(field),sun=new DirectionalLight(),calls:(DirectionalLight|undefined)[]=[],sh=new SphericalHarmonics3()
 const raf=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=callback=>{callback(0);return 0}
 uniforms.hdSkySunIrradiance.value.set(1,2,3)
 try{
  const output=await prepareSunOffField({field,uniforms,sun,gain:1,passes:6,lights:[],cancelled:()=>calls.length>0,display:()=>field,
   transport:{relighting:true,canRelight:()=>true,async relight(_i:number,_p:number[],_l:unknown,source:DirectionalLight|undefined){calls.push(source);return sh}} as never,
   client:{} as never,async upload(){throw Error('Cancelled output must not be uploaded')}})
  assert.equal(output,undefined);assert.deepEqual(calls,[undefined,sun]);assert.deepEqual(uniforms.hdSkySunIrradiance.value.toArray(),[1,2,3])
 }finally{globalThis.requestAnimationFrame=raf;field.dispose()}
})
