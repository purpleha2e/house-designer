import {Matrix4,Mesh,Vector3} from 'three'
import type {RootState} from '@react-three/fiber'
import {snapshotIndirectGeometry,createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility.ts'
import {NextAcceleration} from '../giNextAcceleration.ts'

export function accelerationExperiment(s:RootState,options={samples:12000,repeats:1}){
  const parts=snapshotIndirectGeometry(s.scene).filter(p=>p.ranges.some(r=>r.count>=3)),acceleration=new NextAcceleration(),keys:string[]=[],shared=new Map<object,Map<string,string>>(),indexIds=new Map<object,number>()
  const sofa=s.scene.getObjectByName('model-transform-96cca887-d5d4-4fef-a941-c3638911c06a')!,arrays=new Set<object>()
  sofa.traverse(o=>{if(o instanceof Mesh)arrays.add(o.geometry.attributes.position.array)})
  const sofaParts=parts.flatMap((p,i)=>arrays.has(p.position)?[i]:[])
  const start=performance.now()
  parts.forEach((part,i)=>{let variants=shared.get(part.position);if(!variants){variants=new Map();shared.set(part.position,variants)}if(part.index&&!indexIds.has(part.index))indexIds.set(part.index,indexIds.size);const signature=JSON.stringify([part.ranges,part.stride,part.offset,part.normalized,part.index?indexIds.get(part.index):null]);let key=variants.get(signature);if(!key){key=`geometry-${i}`;variants.set(signature,key)}keys.push(key);acceleration.setGeometry(key,'1',part);part.matrices.forEach((m,j)=>acceleration.setInstance(`${i}:${j}`,key,new Matrix4().fromArray(m)))})
  const blasAndInstancesMs=performance.now()-start,at=performance.now();acceleration.rebuild();const tlasBuildMs=performance.now()-at
  const flatStart=performance.now(),whole=createIndirectVisibilityFromSnapshot(parts),flatBuildMs=performance.now()-flatStart
  const ids:{id:string;face:number}[]=[]
  parts.forEach((p,i)=>p.matrices.forEach((_,j)=>p.ranges.forEach(r=>{for(let t=0;t<Math.floor(r.count/3);t++)ids.push({id:`${i}:${j}`,face:Math.floor(r.start/3)+t})})))
  let seed=1234;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)+.5)/4294967296
  const bounds=acceleration.root!.box,size=bounds.getSize(new Vector3()),rays=Array.from({length:options.samples},()=>({origin:new Vector3(bounds.min.x+random()*size.x,bounds.min.y+random()*size.y,bounds.min.z+random()*size.z),direction:new Vector3(random()-.5,random()-.5,random()-.5).normalize(),far:.03+random()*30}))
  const results:Record<string,unknown>[]=[]
  const compare=(reference:typeof whole,label:string)=>{
    let begin=performance.now();const flat=rays.map(r=>reference.hit(r.origin,r.direction,r.far));const flatNearestMs=performance.now()-begin
    begin=performance.now();const local=rays.map(r=>acceleration.hit(r.origin,r.direction,r.far));const localNearestMs=performance.now()-begin
    begin=performance.now();const flatAny=rays.map(r=>reference.occluded(r.origin,r.direction,r.far));const flatAnyMs=performance.now()-begin
    begin=performance.now();const localAny=rays.map(r=>acceleration.occluded(r.origin,r.direction,r.far));const localAnyMs=performance.now()-begin
    let hitMismatch=0,identityMismatch=0,maxDistanceError=0,anyMismatch=0,ties=0
    flat.forEach((h,i)=>{const actual=local[i];if(flatAny[i]!==localAny[i])anyMismatch++;if(!!h!==!!actual)hitMismatch++;if(h&&actual){maxDistanceError=Math.max(maxDistanceError,Math.abs(h.distance-actual.distance));const expected=ids[Math.floor(h.face!.a/3)];if(expected.id!==actual.id||expected.face!==actual.face){if(Math.abs(h.distance-actual.distance)<2e-5)ties++;else identityMismatch++}}})
    const cohorts={all:rays,earlyHits:rays.filter((_,i)=>flat[i]&&flat[i]!.distance<.3),misses:rays.filter((_,i)=>!flat[i])},timings:Record<string,unknown>={}
    for(const [cohort,items]of Object.entries(cohorts)){
      const values={flat:[] as number[],original:[] as number[],optimized:[] as number[]},query={flat:(r:typeof rays[number])=>reference.occluded(r.origin,r.direction,r.far),original:(r:typeof rays[number])=>acceleration.occludedNearest(r.origin,r.direction,r.far),optimized:(r:typeof rays[number])=>acceleration.occluded(r.origin,r.direction,r.far)}
      let checksum=0
      for(let round=-2;round<options.repeats;round++)for(const method of (round%2?['flat','original','optimized']:['optimized','original','flat']) as (keyof typeof values)[]){const began=performance.now();for(const ray of items)checksum+=query[method](ray)?1:0;const elapsed=performance.now()-began;if(round>=0)values[method].push(elapsed)}
      const median=(a:number[])=>[...a].sort((a,b)=>a-b)[a.length>>1];timings[cohort]={rays:items.length,values,medianMs:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,median(v)])),checksum}
    }
    const row={label,rays:rays.length,hitMismatch,anyMismatch,identityMismatch,equalDistanceIdentityAmbiguities:ties,maxDistanceError,flatNearestMs,localNearestMs,flatAnyMs,localAnyMs,timings};results.push(row);return row
  }
  try{
    compare(whole,'cold')
    const edits=[]
    for(const kind of ['translate-20cm','rotate','nonuniform-scale','mirror']){
      const changed=parts.map(p=>({...p,matrices:p.matrices.map(m=>m.slice())})),before=acceleration.builds,begin=performance.now()
      for(const i of sofaParts)changed[i].matrices.forEach((m,j)=>{const original=new Matrix4().fromArray(m),centre=new Vector3().setFromMatrixPosition(original),delta=kind==='translate-20cm'?new Matrix4().makeTranslation(.2,0,0):kind==='rotate'?new Matrix4().makeRotationY(.3):new Matrix4().makeScale(kind==='mirror'?-1:1.1,.9,1.2);if(kind!=='translate-20cm')delta.premultiply(new Matrix4().makeTranslation(...centre.toArray())).multiply(new Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z));const transform=delta.multiply(original);changed[i].matrices[j]=transform.toArray();acceleration.setInstance(`${i}:${j}`,keys[i],transform)})
      const localTransformAndRefitMs=performance.now()-begin,flatAt=performance.now(),flat=createIndirectVisibilityFromSnapshot(changed,whole.snapshot()),flatUpdateMs=performance.now()-flatAt
      try{edits.push({kind,localTransformAndRefitMs,flatUpdateMs,flatRefitted:flat.refitted,blasBuilds:acceleration.builds-before,correctness:compare(flat,kind)})}finally{flat.dispose()}
    }
    const samples=[];for(let repeat=0;repeat<100;repeat++){const begin=performance.now();for(const i of sofaParts)parts[i].matrices.forEach((m,j)=>acceleration.setInstance(`${i}:${j}`,keys[i],new Matrix4().makeTranslation(repeat%2*.2,0,0).multiply(new Matrix4().fromArray(m))));samples.push(performance.now()-begin)}
    const snapshot=whole.snapshot(),flatBytes=snapshot.positions.byteLength+(snapshot.tree?.index?.byteLength??0)+(snapshot.tree?.roots.reduce((s,r)=>s+r.byteLength,0)??0)
    return{blasAndInstancesMs,tlasBuildMs,flatBuildMs,flatGeometryAndTreeBytes:flatBytes,localMemory:acceleration.memory(),parts:parts.length,sofaParts,triangleCount:ids.length,results,edits,transform100:{meanMs:samples.reduce((a,b)=>a+b)/samples.length,maxMs:Math.max(...samples)},scope:'Read-only scene snapshot; transform experiments do not edit the authored scene or run GI transport; flat memory excludes the extra optimized any-hit arrays.'}
  }finally{whole.dispose();acceleration.dispose()}
}
