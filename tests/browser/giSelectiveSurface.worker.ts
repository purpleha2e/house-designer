import {DataUtils,Vector3} from 'three'
import {restoreIndirectField} from '../../src/indirectLighting.ts'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic.ts'
import {createSelectiveEstimator} from '../giSelectiveEstimator.ts'
import {createSceneLightingReference} from '../sceneLightingReference.ts'

self.onmessage=({data})=>{
  const field=restoreIndirectField(data.field);field.coefficients=data.coefficients;field.volume.data.set(data.volume);field.floorLayer.data.set(data.floorLayer);field.floorLayer.ready=true
  const started=performance.now(),offsetPoint=new Vector3(),estimator=createSelectiveEstimator(data.scene,(p,n)=>{
    const floor=Math.max(0,field.floors.findIndex((_,i)=>p.y>=field.ranges[i].bottom&&p.y<field.ranges[i].top));offsetPoint.copy(p).addScaledVector(n,.002)
    return sampleDisplayedIndirect(field,floor,offsetPoint,n).rgb
  }),setupMs=performance.now()-started
  try{
    const selectAt=performance.now(),points=data.points.map((p:any)=>{
      const floor=Math.max(0,field.floors.findIndex((_,i)=>p.position[1]>=field.ranges[i].bottom&&p.position[1]<field.ranges[i].top)),step=[field.bounds.size/(field.volume.n-1),(field.ranges[floor].top-field.ranges[floor].bottom)/11,field.bounds.size/(field.volume.n-1)],offset=.02+p.normal.reduce((s:number,n:number,i:number)=>s+Math.abs(n)*step[i],0),visible=p.direct.links.filter((l:any)=>!l.blocked).length,disagreement=Math.max(...p.volume.map((v:number,c:number)=>Math.abs(v-p.direct.rgb[c]))),selection=estimator.select(p,offset,visible,p.direct.links.length-visible,disagreement,p.face)
      const coefficients=Array.from({length:3},()=>[0,0,0,0]),total=p.direct.links.reduce((s:number,l:any)=>s+l.weight,0)
      for(const l of p.direct.links)for(let c=0;c<3;c++)for(let k=0;k<4;k++)coefficients[c][k]+=l.weight/(total||1)*DataUtils.fromHalfFloat(field.coefficients[c][l.index*4+k])
      return{...p,selection,controlCoefficients:coefficients}
    }),selectionMs=performance.now()-selectAt
    const seeds=[1723,4517,7753,10103,19139,29243,40751,51001],budgets=[4,8,16,32],experiments=[]
    for(const budget of budgets)for(const seed of seeds){self.postMessage({progress:{budget,seed}});const begin=performance.now(),before=estimator.stats(),values=points.map((p:any,i:number)=>{
      if(!p.selection.selected)return{replace:p.volume,half:p.volume,control:p.volume}
      const value=estimator.evaluate(p,budget,seed+i*1009,p.controlCoefficients)
      return{replace:value.replace,half:value.replace.map((v:number,c:number)=>(v+p.volume[c])*.5),control:value.control}
    });const after=estimator.stats();experiments.push({budget,seed,cpuMs:performance.now()-begin,queries:after.rays-before.rays,shadowRays:after.shadowRays-before.shadowRays,terminalCalls:after.terminalCalls-before.terminalCalls,values})}
    // Reference is evaluated only after candidate selection and all seed runs.
    // It cannot affect the selector, estimator, seeds or correction weight.
    self.postMessage({progress:{stage:'32768-path detailed reference'}})
    const reference=createSceneLightingReference(data.scene),referenceAt=performance.now()
    let detailed
    try{detailed=points.filter((p:any)=>p.cohort==='detailed').map((p:any,i:number)=>{self.postMessage({progress:{stage:'reference',index:i}});return{name:p.name,reference:reference.evaluate(p,32768,6,87123+i*1009)}})}finally{reference.dispose()}
    self.postMessage({ok:true,setupMs,selectionMs,referenceMs:performance.now()-referenceAt,selected:points.filter((p:any)=>p.selection.selected).length,points:points.map((p:any)=>{const{controlCoefficients,...rest}=p;return rest}),experiments,detailed,terminal:'Completed production irradiance volume sampled 2 mm beyond the hit normal, plus exact shadowed direct sun/lamps and authored diffuse albedo. A biased one-bounce terminal-field estimator; no repeated local bounces; global bake settings unchanged.',seedPolicy:'Eight fixed seeds; independent of reference and selector; 4,8,16,32 are prefix-related within each seed.',scope:'CPU samples only, not a GPU representation. 50% correction is a convex blend, not added energy. SH control variate subtracts sampled signed L1 and adds its analytic irradiance; nonnegative output clamp introduces bias.'})
  }catch(error){self.postMessage({ok:false,error:String(error)})}finally{estimator.dispose();field.dispose()}
}
