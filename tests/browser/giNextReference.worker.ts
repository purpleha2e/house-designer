import {createSceneLightingReference} from '../sceneLightingReference.ts'
self.onmessage=({data})=>{
  const started=performance.now(),reference=createSceneLightingReference(data.scene)
  try{const results=data.points.map((p:any,i:number)=>{if(i%100===0)self.postMessage({progress:{index:i,total:data.points.length}});return{...p,reference:reference.evaluate(p,data.samples??256,6,8917+i*1009),localPaths:reference.evaluate(p,64,6,17171+i*1009)}});self.postMessage({ok:true,results,elapsedMs:performance.now()-started})}
  catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose()}
}
