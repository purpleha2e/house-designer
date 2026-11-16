import {Vector3} from 'three'
import {sampleSunTexture,type SunTexture,type createSunSurfaceQuery,type SunMaterial} from './localSunTransport.ts'

export type RefinementLight={position:number[];color:number[];direction:number[];distance:number;decay:number;cone:number;penumbra:number}
export type RefinementMaterial=SunMaterial&{emission?:number[];emissionMap?:number;emissionSampling?:Pick<SunMaterial,'matrix'|'wrapS'|'wrapT'>}
export type RefinementSources={skyBase:number[];skySun:number[];skyMode:'clear'|'overcast';sunDirection:number[];sunIrradiance:number[];lights:RefinementLight[]}
type Query=ReturnType<typeof createSunSurfaceQuery>
const radicalInverse=(index:number,base:number)=>{let value=0,scale=1/base;while(index){value+=(index%base)*scale;index=Math.floor(index/base);scale/=base}return value}

/** Diffuse receiver integration over physical scene triangles, including off-screen
 * sources. It replaces probe irradiance; direct receiver lighting is never added.
 * Finite paths include sky, textured diffuse reflection, lamps and emission.
 * Unsupported hits invalidate the receiver rather than silently becoming black. */
export function createSurfaceRefinementTransport(query:Query,shadow:Query,sources:RefinementSources,materials:RefinementMaterial[],textures:SunTexture[]){
 const lamps=sources.lights.filter(light=>light.color.some(value=>value>0)),hasSun=sources.sunIrradiance.some(value=>value>0)
 let shadowRays=0
 const sun=new Vector3().fromArray(sources.sunDirection).normalize(),axis=new Vector3(),tangent=new Vector3(),bitangent=new Vector3(),direction=new Vector3(),origin=new Vector3(),toLight=new Vector3()
 const cosineDirection=(normal:Vector3,u:number,v:number)=>{
  axis.set(Math.abs(normal.y)<.9?0:1,Math.abs(normal.y)<.9?1:0,0)
  tangent.crossVectors(axis,normal).normalize();bitangent.crossVectors(normal,tangent)
  const r=Math.sqrt(u),angle=v*2*Math.PI
  return direction.copy(normal).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,r*Math.cos(angle)).addScaledVector(bitangent,r*Math.sin(angle))
 }
 const environment=(d:Vector3)=>sources.skyBase.map((base,c)=>d.y>=0?base*(sources.skyMode==='overcast'?.5+d.y:.6+.8*d.y):.2*(base*(sources.skyMode==='overcast'?7/6:17/15)+sources.skySun[c]/Math.PI))
 const blocked=(p:Vector3,d:Vector3,far=80)=>{
  shadowRays++
  const hit=shadow.hit(p,d,far,.0001)
  if(hit&&!shadow.material(hit,d).valid)throw Error('Unsupported shadow material')
  return !!hit
 }
 return {environment,gather(receiver:{position:readonly number[];normal:readonly number[];geometricNormal:readonly number[]},samples:number,bounces:number,seed=1,startSample=0){
  if(!Number.isInteger(samples)||samples<1||samples>4096||!Number.isInteger(bounces)||bounces<1||bounces>8)throw Error('Invalid surface refinement budget')
  const normal=new Vector3().fromArray(receiver.normal).normalize(),geometric=new Vector3().fromArray(receiver.geometricNormal).normalize(),point=new Vector3().fromArray(receiver.position)
  const sum=[0,0,0],shift1=((seed>>>0)*.6180339887498949)%1,shift2=((seed>>>0)*.4142135623730951)%1
  let rays=0;shadowRays=0
  try{
   for(let sample=startSample;sample<startSample+samples;sample++){
    let randomState=(seed^Math.imul(sample+1,2654435761))>>>0
    const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return(randomState+.5)/4294967296}
    cosineDirection(normal,(radicalInverse(sample+1,2)+shift1)%1,(radicalInverse(sample+1,3)+shift2)%1)
    origin.copy(point).addScaledVector(geometric,.0002)
    const throughput=[1,1,1]
    for(let bounce=0;bounce<bounces;bounce++){
     rays++;const hit=query.hit(origin,direction,80,.0001)
     if(!hit){const sky=environment(direction);for(let c=0;c<3;c++)sum[c]+=throughput[c]*sky[c];break}
     const surface=query.material(hit,direction)
     if(!surface.valid)return {valid:false,rgb:[0,0,0],rays,shadowRays,reason:surface.reason}
     const material=materials[surface.materialId],n=surface.normal,light=[0,0,0]
     origin.copy(hit.point).addScaledVector(n,.0002)
     const sunCosine=Math.max(0,n.dot(sun))
     if(sunCosine>0&&hasSun&&!blocked(origin,sun))for(let c=0;c<3;c++)light[c]+=sources.sunIrradiance[c]*sunCosine
     for(const lamp of lamps){
      toLight.fromArray(lamp.position).sub(origin);const distance=toLight.length();if(distance<.0001)continue
      toLight.divideScalar(distance)
      let weight=Math.max(0,n.dot(toLight))/Math.max(.01,distance**lamp.decay)
      if(lamp.distance>0)weight*=Math.max(0,1-(distance/lamp.distance)**4)**2
      if(lamp.cone>=0){const cone=-(toLight.x*lamp.direction[0]+toLight.y*lamp.direction[1]+toLight.z*lamp.direction[2]),t=Math.max(0,Math.min(1,(cone-lamp.cone)/Math.max(1e-12,lamp.penumbra-lamp.cone)));weight*=t*t*(3-2*t)}
      if(weight>0&&!blocked(origin,toLight,Math.max(.0001,distance-.0001)))for(let c=0;c<3;c++)light[c]+=lamp.color[c]*weight
     }
     const emissionMap=material.emissionMap!==undefined&&material.emissionMap>=0?textures[material.emissionMap]:undefined
     const emission=emissionMap?sampleSunTexture(emissionMap,surface.uv,material.emissionSampling??material):[1,1,1]
     for(let c=0;c<3;c++){
      sum[c]+=throughput[c]*(surface.rho[c]*light[c]/Math.PI+(material.emission?.[c]??0)*emission[c])
      throughput[c]*=surface.rho[c]
     }
     if(throughput.every(v=>v<1e-7))break
     cosineDirection(n,random(),random())
    }
   }
   return {valid:true,rgb:sum.map(v=>v*Math.PI/samples),rays,shadowRays}
  }catch(error){return {valid:false,rgb:[0,0,0],rays,shadowRays,reason:String(error)}}
 }}
}
