import {DataUtils,Vector3} from 'three'
export function attachDoorPipelineCapture(s:any,ids:number[]){
 const render=s.gl.render,reads:Promise<any>[]=[];let atlas:any,lastReduction:any
 const decode=(pixels:Uint16Array,cache:any)=>ids.map(index=>{const samples=[];for(let face=0;face<6;face++){
  const [x,y]=cache.layout.tile(index,face),size=cache.layout.size
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
   const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3,o=((y+row)*cache.layout.width+x+col)*4
   samples.push({face,row,col,direction:d.normalize().toArray(),weight,rgb:[0,1,2].map(c=>DataUtils.fromHalfFloat(pixels[o+c]))})
  }
 }return{index,samples}})
 s.gl.render=function(...args:any[]){
  const u=args[0].children[0]?.material?.uniforms,target=s.gl.getRenderTarget(),result=render.apply(this,args)
  if(u?.hdSurfacePositions)atlas=target
  if(u?.hdSurfaceBatch?.value===1&&target?.viewport.y===0&&atlas){
   const cache=s.scene.userData.getIndirectSurfaceCache(),pixels=new Uint16Array(atlas.width*atlas.height*4),pass=s.scene.userData.indirectLighting.pass
   const pending=s.gl.readRenderTargetPixelsAsync(atlas,0,0,atlas.width,atlas.height,pixels).then(()=>({observedPass:pass,probes:decode(pixels,cache)}));reads.push(pending);lastReduction=target
  }
  return result
 }
 return{async finish(){
  s.gl.render=render
  const cache=s.scene.userData.getIndirectSurfaceCache(),field=s.scene.userData.getLightingField(),size=cache.layout.size
  const base=new Uint16Array(cache.layout.width*cache.layout.height*4)
  await s.gl.readRenderTargetPixelsAsync(cache.currentRadiance,0,0,cache.layout.width,cache.layout.height,base)
  const source=decode(base,cache),passes=await Promise.all(reads),metadata=[]
  for(const index of ids){const faces=[];for(let face=0;face<6;face++){
   const [x,y]=cache.layout.tile(index,face),positions=new Float32Array(size*size*4),normals=new Float32Array(size*size*4),response=new Uint16Array(size*size*4)
   await s.gl.readRenderTargetPixelsAsync(cache.target,x,y,size,size,positions,undefined,1)
   await s.gl.readRenderTargetPixelsAsync(cache.target,x,y,size,size,normals,undefined,2)
   await s.gl.readRenderTargetPixelsAsync(cache.target,x,y,size,size,response,undefined,3)
   faces.push({face,positions:Array.from(positions),normals:Array.from(normals),response:Array.from(response,DataUtils.fromHalfFloat)})
  }metadata.push({index,position:Array.from(field.positionData.subarray(index*4,index*4+3)),near:cache.captureNear(index),faces})}
  return{size,source,passes,metadata,shOrder:field.shOrder,probeCount:field.probes.length,coefficients:field.coefficients.map((a:Uint16Array)=>Array.from(a)),state:s.scene.userData.indirectLighting,profile:s.scene.userData.getLightingPerformance(),camera:{position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),projection:s.camera.projectionMatrix.toArray()},exposure:s.gl.toneMappingExposure,settings:s.scene.userData.getBakedIndirectLighting().settings,reductionSeen:!!lastReduction,glError:s.gl.getContext().getError()}
 },dispose(){s.gl.render=render}}
}
