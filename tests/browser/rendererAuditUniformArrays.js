// Experimental value cache for the specific shared numeric arrays identified
// by the main-pass audit. Disabled until explicitly selected by the driver.
// Samplers, per-object transforms and Three's existing scalar caches are intact.
const names=new Set(['directionalShadowMatrix','pointShadowMatrix','hdGIFloorRanges','hdGIPointIndices','hdPointLightRoomIds','hdPointOcclusionIds','hdSpotLightRoomIds','hdSpotOcclusionIds','hdRoomLightFloorHeights','hdLightPortalEdgeRanges','hdLightPortalHeights'])
const widths=new Map([[0x1406,1],[0x8b50,2],[0x8b51,3],[0x8b52,4],[0x8b5a,4],[0x8b5b,9],[0x8b5c,16]])
const vectorKeys=['x','y','z','w'],colourKeys=['r','g','b']
export function installUniformArrayExperiment(renderer){
 let enabled=false,epoch=0
 const patched=new WeakSet(),restorers=[],stats={entries:0,calls:0,skipped:0,writes:0}
 function patchPrograms(){
  for(const program of renderer.info.programs??[])for(const u of program.getUniforms().seq){
   if(patched.has(u)||!names.has(u.id)||u.size===undefined||!widths.has(u.type))continue
   patched.add(u);stats.entries++
   const original=u.setValue,width=widths.get(u.type);let validEpoch=-1,last=[]
   const at=(value,i,flat)=>{if(flat)return value[i];const member=value[Math.floor(i/width)],c=i%width;return member?.elements?member.elements[c]:member?.[(member.isColor?colourKeys:vectorKeys)[c]]}
   const wrapper=function(gl,value,textures){
    stats.calls++
    if(!enabled){validEpoch=-1;stats.writes++;return original.call(this,gl,value,textures)}
    const flat=value&&typeof value[0]==='number',count=value?.length*(flat?1:width)
    let same=validEpoch===epoch&&last.length===count&&count>0
    for(let i=0;same&&i<count;i++){const n=at(value,i,flat);same=typeof n==='number'&&n===n&&Object.is(last[i],n)}
    if(same){stats.skipped++;return}
    validEpoch=-1;stats.writes++
    const result=original.call(this,gl,value,textures)
    if(!(count>0))return result
    last.length=count
    let valid=true
    for(let i=0;i<count;i++){const n=at(value,i,flat);last[i]=n;valid&&=typeof n==='number'&&n===n}
    if(valid)validEpoch=epoch
    return result
   }
   u.setValue=wrapper;restorers.push(()=>{if(u.setValue===wrapper)u.setValue=original})
  }
 }
 patchPrograms()
 return{stats,set(value){enabled=value},get enabled(){return enabled},reset(){epoch++},patchPrograms,dispose(){enabled=false;for(const restore of restorers.reverse())restore()}}
}
