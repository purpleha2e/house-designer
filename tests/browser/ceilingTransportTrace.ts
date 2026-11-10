import {DataUtils} from 'three'
/** Observes completed pass boundaries without altering capture or transport. */
export function ceilingTransportTrace(s:any,indices:number[]){
 if(!new URLSearchParams(location.search).has('ceiling-transport'))throw Error('Diagnostic flag required')
 let atlas:any,status=s.scene.userData.indirectLighting,lastAt=performance.now(),lastSun:any
 const passes:any[]=[],render=s.gl.render
 s.gl.render=function(scene:any,camera:any){
  const u=scene.children.find((o:any)=>o.material?.uniforms?.hdSurfaceResponses||o.material?.uniforms?.hdSunColor)?.material.uniforms
  if(u?.hdSurfaceResponses)atlas=s.gl.getRenderTarget()
  if(u?.hdSunColor)lastSun={color:u.hdSunColor.value.toArray(),direction:u.hdSunDirection.value.toArray()}
  return render.call(this,scene,camera)
 }
 const capture=(pass:number)=>{
  const field=s.scene.userData.getLightingField(),cache=s.scene.userData.getIndirectSurfaceCache(),target=pass===1?cache?.currentRadiance:atlas
  if(!cache||!target)throw Error('Missing pass atlas')
  const start=performance.now(),size=cache.layout.size,probes=[]
  const read=(target:any,x:number,y:number,index=0)=>{
   const float=target.textures[index].type===1015,pixels=float?new Float32Array(size*size*4):new Uint16Array(size*size*4)
   s.gl.readRenderTargetPixels(target,x,y,size,size,pixels,0,index)
   return Array.from(pixels,v=>float?v:DataUtils.fromHalfFloat(v))
  }
  for(const index of indices){const p=field.probes.find((p:any)=>p.index===index);if(!p)continue
   const faces=[]
   for(let face=0;face<6;face++){const [x,y]=cache.layout.tile(index,face);faces.push({face,radiance:read(target,x,y),...(pass===1?{receiver:read(cache.target,x,y,1),normal:read(cache.target,x,y,2),response:read(cache.target,x,y,3),material:cache.target.textures.length>4?read(cache.target,x,y,4):null,staticRadiance:read(cache.radiance,x,y)}:{})})}
   probes.push({index,position:p.position.toArray(),coefficients:field.coefficients.map((a:Uint16Array)=>Array.from(a.subarray(index*4,index*4+4),DataUtils.fromHalfFloat)),faces})
  }
  const now=performance.now();passes.push({pass,probes,allCoefficients:field.probes.map((p:any)=>({index:p.index,position:p.position.toArray(),rgb:field.coefficients.map((a:Uint16Array)=>Array.from(a.subarray(p.index*4,p.index*4+4),DataUtils.fromHalfFloat))})),wallMs:start-lastAt,readbackMs:now-start,lastSun});lastAt=now
 }
 const wrap=(value:any)=>value&&new Proxy(value,{set(target,key,value){Reflect.set(target,key,value);if(key==='fullPassPublications'&&Number(value)>0)capture(Number(value));return true}})
 status=wrap(status);Object.defineProperty(s.scene.userData,'indirectLighting',{configurable:true,get:()=>status,set:value=>{status=wrap(value)}})
 return {state:()=>({passes,lastSun}),dispose(){s.gl.render=render}}
}
