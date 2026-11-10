import {DataUtils,type DirectionalLight,type SphericalHarmonics3} from 'three'
import type {IndirectField} from './indirectLighting'
import type {IndirectLightingClient} from './indirectLightingClient'
import type {IndirectUniforms} from './indirectLightingShader'
import {updateIndirectUniforms} from './indirectLightingShader.ts'
import {createIndirectBounceField} from './indirectLivePreview.ts'
import type {createIndirectSurfaceCache} from './indirectSurfaceCache'
import type {SurfaceLight} from './indirectSurfaceRelighting'

/** Ordinary Jacobi transport on the existing receiver cache. This field is
 * display-only and is never promoted to the persistent production cache. */
export async function prepareSunOffField({field,transport,uniforms,client,lights,sun,gain,passes,cancelled,display,upload,onPass,restoreAllowed=()=>true}:{
  field:IndirectField;transport:NonNullable<ReturnType<typeof createIndirectSurfaceCache>>;uniforms:IndirectUniforms;client:IndirectLightingClient;
  lights:SurfaceLight[];sun?:DirectionalLight;gain:number;passes:number;cancelled:()=>boolean;display:()=>IndirectField;
  upload:(field:IndirectField,cancelled:()=>boolean)=>Promise<boolean>;onPass?:(pass:number)=>void;
  restoreAllowed?:()=>boolean;
}){
  if(field.shOrder!==1||field.contactLighting)throw Error('Sun bounce experiment requires the standard L1 probe layout')
  if(!transport.relighting||field.probes.some(p=>!transport.canRelight(p.index)))throw Error('A complete relightable surface cache is required')
  const output=createIndirectBounceField(field);output.coefficients=field.coefficients.map(a=>new Uint16Array(a.length))
  const write=(index:number,sh:SphericalHarmonics3)=>{for(let k=0;k<field.coefficientCount;k++)for(let c=0;c<3;c++)output.coefficients[c][index*field.coefficientCount+k]=DataUtils.toHalfFloat(sh.coefficients[k].getComponent(c))}
  const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  let retained=false
  const touched=new Set<number>()
  const bind=(draw:()=>void)=>{updateIndirectUniforms(uniforms,output);uniforms.hdGIUseVolume.value=1;try{draw()}finally{updateIndirectUniforms(uniforms,display());uniforms.hdGIUseVolume.value=1}}
  try{
    // Remove directional and ground-reflected sunlight together, preserving sky,
    // lamps, emission and immutable surface records. Never alter the live sun.
    for(const probe of field.probes){
      if(cancelled())return
      const ground=uniforms.hdSkySunIrradiance.value.clone();let read:ReturnType<typeof transport.relight>
      try{uniforms.hdSkySunIrradiance.value.set(0,0,0);touched.add(probe.index);read=transport.relight(probe.index,Array.from(field.positionData.subarray(probe.index*4,probe.index*4+3)),lights,undefined,gain)}
      finally{uniforms.hdSkySunIrradiance.value.copy(ground)}
      write(probe.index,await read);await tick()
    }
    for(let pass=1;pass<=passes;pass++){
      if(cancelled())return
      if(pass>1){
        const result=await transport.readBatch(field.probes.map(p=>p.index),cancelled,(_name,draw)=>bind(draw))
        if(!result||cancelled())return
        for(const [index,sh]of result)write(index,sh)
      }
      const data=await client.volume(output.coefficients,field.positionData)
      if(cancelled())return
      output.volume.data=data.volume as typeof output.volume.data;output.floorLayer.data=data.floor as typeof output.floorLayer.data
      if(!await upload(output,cancelled))return
      onPass?.(pass)
    }
    if(cancelled())return
    retained=true;return output
  }finally{
    try{
      // Restore even when the user disables the experiment during preparation.
      // Replaced/disposed capture generations must never be touched.
      for(const index of touched){
        if(!restoreAllowed())break
        await transport.relight(index,Array.from(field.positionData.subarray(index*4,index*4+3)),lights,sun,gain)
        await tick()
      }
    }catch(error){retained=false;throw error}
    finally{if(!retained)output.dispose()}
  }
}
