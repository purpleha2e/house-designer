type FastGIProgress = { state?:string; firstVisibleMs?:number; error?:string }

export function formatFastGIProgress(enabled:boolean,status?:FastGIProgress,weight=0) {
  if(!enabled)return 'Fast GI off'
  if(status?.error)return `Fast GI unavailable: ${status.error}`
  if(status?.state==='ready') {
    if(weight<=.001)return 'Fast GI ready · displaying probes'
    const timing=status.firstVisibleMs===undefined?'':` · ${Math.round(status.firstVisibleMs)} ms`
    return `Fast GI active · ${Math.round(weight*100)}%${timing}`
  }
  if(status?.state==='capture')return 'Fast GI capturing surfaces…'
  if(status?.state==='reconstruct')return 'Fast GI reconstructing surfaces…'
  if(status?.state==='gather'||status?.state==='bounce')return 'Fast GI calculating bounce light…'
  return 'Fast GI preparing…'
}
