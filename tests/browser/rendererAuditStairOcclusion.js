// Isolated Phase 4 query experiment. The renderer and navigation are untouched.
export async function installStairOcclusionExperiment() {
 const s=rendererRecovery.state(),{Raycaster,Vector3,getEditorFiber}=await rendererRecovery.modules(),labels=[]
 const visit=f=>{if(!f)return;const p=f.memoizedProps;if(p?.position&&p.children?.props?.className==='viewer-stair-button')labels.push(p.position);visit(f.child);visit(f.sibling)};visit(getEditorFiber())
 if(labels.length!==1)throw Error('This controlled fixture requires exactly one stair label')
 const position=new Vector3(...labels[0]),anchors=[];s.scene.traverse(o=>{if(o.type==='Group'&&o.position.distanceTo(position)<1e-8)anchors.push(o)})
 if(anchors.length!==1)throw Error('Stair label anchor must resolve uniquely')
 const anchor=anchors[0],point=new Vector3(),query=new Raycaster(),hits=[],source=s.raycaster,original=source.intersectObjects
 let enabled=false,paired=false,nullControl=false,index=0
 const records=[],stats={referenceQueries:0,candidateQueries:0,mismatches:0,objectsTested:0}
 const early=(object,distance)=>{
  let propagate=true
  if(object.layers.test(query.layers)){
   hits.length=0;stats.objectsTested++
   propagate=object.raycast(query,hits)!==false
   if(hits.some(hit=>hit.distance<=distance))return true
  }
  if(propagate)for(const child of object.children)if(early(child,distance))return true
  return false
 }
 const candidate=distance=>{
  stats.candidateQueries++;query.ray.copy(source.ray);query.camera=source.camera;query.layers.mask=source.layers.mask
  query.near=source.near;query.far=Math.min(source.far,distance);query.params=source.params
  return early(s.scene,distance)
 }
 const reference=(args,distance)=>{stats.referenceQueries++;const all=original.apply(source,args);return{all,blocked:all.length>0&&!(distance<all[0].distance)}}
 const replacement=function(...args){
  if(args[0]?.length!==1||args[0][0]!==s.scene||args[1]===false)return original.apply(this,args)
  const distance=anchor.getWorldPosition(point).distanceTo(source.ray.origin)
  if(paired){
   const referenceFirst=index++%2===0;let a,z,referenceMs,candidateMs
   const runReference=()=>{const at=performance.now();a=reference(args,distance);referenceMs=performance.now()-at}
   const runCandidate=()=>{const at=performance.now();z=nullControl?reference(args,distance).blocked:candidate(distance);candidateMs=performance.now()-at}
   if(referenceFirst){runReference();runCandidate()}else{runCandidate();runReference()}
   const equal=a.blocked===z;stats.mismatches+=Number(!equal);records.push({referenceFirst,referenceMs,candidateMs,savedMs:referenceMs-candidateMs,equal,blocked:z})
   return a.all
  }
  if(!enabled)return original.apply(this,args)
  return candidate(distance)?[{distance:0,point:point.clone(),object:anchor}]:[]
 }
 source.intersectObjects=replacement
 return{stats,records,anchor:()=>anchor.getWorldPosition(new Vector3()).toArray(),set(value){enabled=value},pair(value,isNull=false){paired=value;nullControl=isNull},dispose(){if(source.intersectObjects===replacement)source.intersectObjects=original}}
}
