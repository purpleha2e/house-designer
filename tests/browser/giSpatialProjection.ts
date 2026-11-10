import {DataUtils,Vector3,type WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import {indirectSHRadianceBasis} from '../../src/indirectSH'

/** One atlas read, then project the identical final captured rays to both SH
 * orders. No replay, extra bounce, probe change or production setting change. */
export async function captureHouseProjection(s:RootState,atlas:WebGLRenderTarget){
 if(!atlas)throw Error('Completed radiance atlas unavailable')
 const field=s.scene.userData.getLightingField(),cache=s.scene.userData.getIndirectSurfaceCache(),size=cache.layout.size,pixels=new Uint16Array(atlas.width*atlas.height*4)
 await s.gl.readRenderTargetPixelsAsync(atlas,0,0,atlas.width,atlas.height,pixels)
 const quadrature=[]
 for(let face=0;face<6;face++)for(let row=0;row<size;row++)for(let col=0;col<size;col++){
  const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3
  quadrature.push({face,row,col,weight,basis:indirectSHRadianceBasis(d.normalize(),2)})
 }
 const factor=4*Math.PI/quadrature.reduce((s,p)=>s+p.weight,0)
 const probes=field.probes.map((p:{index:number;position:Vector3})=>{
  const coefficients=Array.from({length:9},()=>[0,0,0])
  for(const q of quadrature){const [x,y]=cache.layout.tile(p.index,q.face),offset=((y+q.row)*atlas.width+x+q.col)*4;for(let c=0;c<3;c++){const value=DataUtils.fromHalfFloat(pixels[offset+c]);for(let k=0;k<9;k++)coefficients[k][c]+=value*q.weight*factor*q.basis[k]}}
  const maxCoefficientDifference=Math.max(...coefficients.slice(0,field.coefficientCount).flatMap((v,k)=>v.map((v,c)=>Math.abs(v-DataUtils.fromHalfFloat(field.coefficients[c][p.index*field.coefficientCount+k])))))
  return{index:p.index,position:p.position.toArray(),coefficients,maxCoefficientDifference}
 })
 return{probes,generation:s.scene.userData.indirectLighting.generation,scope:'Both L1 and L2 projected from the same final six-pass L1-transport atlas. This isolates angular reconstruction; it is not a full L2 feedback bake.',maxCoefficientDifference:Math.max(...probes.map((p:typeof probes[number])=>p.maxCoefficientDifference))}
}
