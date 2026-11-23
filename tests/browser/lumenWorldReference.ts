import type {RootState} from '@react-three/fiber'
import {WebGLRenderer} from 'three'
import {snapshotReferenceScene} from '../../src/diffuseSceneSnapshot'
import {createSceneLightingReference} from '../sceneLightingReference'
import {createReferenceGlazing} from './lumenReferenceGlazing'

type Grid={name:string;width:number;height:number;normal:number[];points:number[][]}
const add=(a:number[],b:number[])=>a.map((x,i)=>x+b[i])
const minus=(a:number[],b:number[])=>a.map((x,i)=>x-b[i])

export async function traceWorldReference(s:RootState,grids:Grid[],progress:(count:number)=>void){
  const gl=new WebGLRenderer()
  const snapshot=await snapshotReferenceScene({scene:s.scene,gl},m=>m.userData.houseDesignerRole==='ground-plane'?3:0,{diffusePbr:true})
    .finally(()=>{gl.dispose();gl.forceContextLoss()})
  const panes=createReferenceGlazing(s.scene,s.camera),model=createSceneLightingReference(snapshot.data,panes.transmit)
  let count=0
  try{
    const output=[]
    for(const {name,points,normal,width,height} of grids){
      const rows=[]
      for(const [index,position] of points.entries()){
        const eye=position.map((x,i)=>x+normal[i]*.035),behind=position.map((x,i)=>x-normal[i]*.006)
        const hit=model.visibleReceiver(eye,behind)
        if(!hit||hit.distanceToEstimate>.011||normal.reduce((n,x,i)=>n+x*hit.normal[i],0)<.995){rows.push(null);continue}
        const high=index%Math.max(1,Math.floor(width/4))===0&&Math.floor(index/width)%5===0
        const measure=(samples:number,seed:number)=>{
          const raw=model.evaluate({name,position:hit.position,normal,geometricNormal:normal},samples,6,seed,7,false,true)
          const toRadiance=(a:number[])=>a.map((x,i)=>x*hit.rho[i]/Math.PI)
          const ground=toRadiance(raw.byOrder![1].exteriorGround)
          const first=minus(toRadiance(add(raw.byOrder![1].sky,raw.byOrder![1].solar)),ground)
          const later=toRadiance(raw.byOrder!.slice(2).reduce((sum,order)=>add(sum,add(order.sky,order.solar)),[0,0,0]))
          const directSky=toRadiance(raw.sky),directSun=toRadiance(raw.direct)
          return {directSun,directSky,exteriorGround:ground,firstBounce:first,laterBounce:later,
            outgoing:add(add(directSun,directSky),toRadiance(raw.reflected)),incoming:add(add(raw.direct,raw.sky),raw.reflected),
            skyStandardError:toRadiance(raw.skyStandardError),bounceStandardError:toRadiance(raw.reflectedStandardError),samples}
        }
        // Common random numbers across each surface make neighbouring changes
        // easier to distinguish from Monte Carlo noise. Sparse anchors retain
        // a second seed at greater depth sample count as a convergence control.
        rows.push({position:hit.position,normal,albedo:hit.rho,material:hit.material, ...measure(384,31973),
          ...(high&&{convergence:measure(3072,50119)})})
        if(++count%12===0){progress(count);await new Promise(resolve=>setTimeout(resolve,0))}
      }
      output.push({name,width,height,points:rows})
    }
    return {grids:output,triangles:snapshot.triangles,panes:panes.count,inputs:{sky:snapshot.data.skyBase,sun:snapshot.data.sunIrradiance,
      direction:snapshot.data.sunDirection,lights:snapshot.data.lights}}
  }finally{model.dispose();panes.dispose()}
}
