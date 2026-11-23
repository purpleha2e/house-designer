const y=v=>.2126*v[0]+.7152*v[1]+.0722*v[2]
const empty=[0,0,0]
const delta=(a,b)=>a.map((v,i)=>v-b[i])
const magnitude=(a,b)=>Math.abs(y(delta(a,b)))
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0)
const maxAbs=a=>Math.max(...a.map(Math.abs))
const clamp=x=>Math.max(-1,Math.min(1,x))
const categoryKeys=['falseHit','falseMiss','wrongNearest','coincidentIdentity','position','normal','reversedNormal','material','reflectance','unmapped']
const routeNames={1:'opening',2:'upward unoccluded',3:'DDA step cap',4:'beyond 7 m',5:'downward unoccluded'}

const distribution=values=>{
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length
  return n?{mean:values.reduce((a,b)=>a+b,0)/n,p95:sorted[Math.min(n-1,Math.floor(.95*n))],max:sorted[n-1]}:{mean:0,p95:0,max:0}
}

function traceMetrics(row,world){
  const {patch:a,exact:b}=row
  const both=Boolean(a&&b),same=both&&a.source===b.source
  const distance=both?Math.abs(a.distance-b.distance):null
  const normalAngle=both?Math.acos(clamp(Math.abs(dot(a.normal,b.normal))))*180/Math.PI:null
  const outside=b&&b.position.some((v,i)=>v<world.origin[i]||v>=world.origin[i]+world.step*world.dimensions[i])
  const differentSurface=both&&(!same||a.material!==b.material||normalAngle>10)
  const visibility=a&&!b?'false occupied':!a&&b?'false clear':both?'both hit':routeNames[row.route]??'finite miss'
  const route=!a&&b?(row.route===3?'DDA step cap':outside?'cache bounds':'missing bounded patch'):visibility
  const flags={
    falseHit:Boolean(a&&!b),falseMiss:Boolean(!a&&b),wrongNearest:differentSurface&&distance>.008,
    coincidentIdentity:differentSurface&&distance<=.008,position:same&&!differentSurface&&distance>.01,
    normal:both&&normalAngle>5,reversedNormal:both&&dot(a.normal,b.normal)<-.98,
    material:both&&a.material!==b.material,reflectance:both&&maxAbs(delta(a.albedo,b.albedo))>.05,
    unmapped:Boolean(b&&b.cache<0),
  }
  const ar=a?.radiance,br=b?.radiance
  const firstA=ar?.contributionInitial??empty,firstB=br?.contributionInitial??empty
  const totalA=ar?.contributionSettled??empty,totalB=br?.contributionSettled??empty
  const laterA=delta(totalA,firstA),laterB=delta(totalB,firstB)
  return {flags,visibility,route,distance,normalAngle,
    first:magnitude(firstA,firstB),later:magnitude(laterA,laterB),total:magnitude(totalA,totalB),
    firstSigned:y(delta(firstB,firstA)),laterSigned:y(delta(laterB,laterA)),
    firstEnergy:(y(firstA)+y(firstB))*.5,laterEnergy:(y(laterA)+y(laterB))*.5,energy:(y(totalA)+y(totalB))*.5}
}

function aggregate(rows){
  const sum=key=>rows.reduce((total,r)=>total+r.metrics[key],0)
  const totalEnergy=sum('energy'),initialEnergy=sum('firstEnergy')
  const categories=Object.fromEntries(categoryKeys.map(key=>{
    const values=rows.filter(row=>row.metrics.flags[key])
    const groupSum=metric=>values.reduce((n,row)=>n+row.metrics[metric],0)
    return [key,{count:values.length,percent:100*values.length/rows.length,
      shareOfEnergy:totalEnergy?groupSum('energy')/totalEnergy:0,
      shareOfInitialEnergy:initialEnergy?groupSum('firstEnergy')/initialEnergy:0,
      absoluteContributionDelta:groupSum('total'),absoluteInitialContributionDelta:groupSum('first')}]
  }))
  const routes={}
  for(const row of rows)routes[row.metrics.route]=(routes[row.metrics.route]??0)+1
  const valid=rows.filter(r=>!r.metrics.flags.unmapped)
  const hits=rows.filter(r=>r.metrics.distance!==null)
  const similar=valid.filter(r=>r.patch&&r.exact&&r.patch.source===r.exact.source&&r.patch.material===r.exact.material&&r.metrics.normalAngle<5)
  const breakdown=Object.fromEntries(['directSun','directSky','exteriorGround','firstBounce','laterBounce'].map(term=>[term,{
    patch:valid.reduce((v,r)=>v+y((r.patch?.radiance?.[term]??empty).map((x,i)=>x*r.rho[i]))/r.divisor,0),
    exact:valid.reduce((v,r)=>v+y((r.exact?.radiance?.[term]??empty).map((x,i)=>x*r.rho[i]))/r.divisor,0),
    error:distribution(similar.map(r=>magnitude(r.patch.radiance[term],r.exact.radiance[term]))),
  }]))
  return {count:rows.length,valid:valid.length,sameCredibleSurface:similar.length,
    categories,routes,distance:distribution(hits.map(r=>r.metrics.distance)),
    first:distribution(valid.map(r=>r.metrics.first)),later:distribution(valid.map(r=>r.metrics.later)),
    total:distribution(valid.map(r=>r.metrics.total)),sameSurfaceInitial:distribution(similar.map(r=>r.metrics.first)),
    firstEnergy:initialEnergy,totalEnergy,absoluteDelta:sum('total'),absoluteInitialDelta:sum('first'),breakdown}
}

export function summarizeVisibility(world,rows){
  const examples=[],groups=new Map()
  for(const row of rows){
    row.metrics=traceMetrics(row,world)
    const key=row.grid+':'+row.index
    let list=groups.get(key)
    if(!list)groups.set(key,list=[])
    list.push(row)
    if(row.kind==='feedback')examples.push(row)
  }
  const keySet=new Set()
  const ranked=key=>[...examples].sort((a,b)=>b.metrics[key]-a.metrics[key]).filter(r=>{
    const key=r.receiver+':'+r.j
    if(keySet.has(key))return false
    keySet.add(key)
    return true
  }).slice(0,12)
  const strongestInitial=ranked('first')
  keySet.clear()
  const strongestSettled=ranked('total')
  const grids=world.grids.map(grid=>({...grid,points:grid.points.map((point,index)=>{
    const rays=groups.get(grid.name+':'+index)?.filter(r=>r.kind==='feedback')
    if(!rays)return {position:point.position,missing:true}
    const valid=rays.filter(r=>!r.metrics.flags.unmapped),metrics=valid.map(r=>r.metrics)
    const sum=(key,values=metrics)=>values.reduce((n,r)=>n+(r[key]??0),0)
    const flags=k=>rays.filter(r=>r.metrics.flags[k]).length/rays.length
    const sumInitial=(rows,key)=>rows.reduce((n,r)=>n+y(r[key]?.radiance?.contributionInitial??empty),0)
    return {position:point.position,patch:point.patch,normal:point.normal,id:point.id,visible:point.visible,
      hitMiss:flags('falseHit')+flags('falseMiss'),visibility:rays.filter(r=>r.metrics.flags.falseHit||r.metrics.flags.falseMiss||r.metrics.flags.wrongNearest).length/rays.length,
      distance:Math.max(...rays.map(r=>r.metrics.distance??0)),
      normalAngle:Math.max(...rays.map(r=>r.metrics.normalAngle??0)),material:flags('material'),unmapped:flags('unmapped'),
      first:sum('first'),later:sum('later'),total:sum('total'),firstSigned:sum('firstSigned'),laterSigned:sum('laterSigned'),
      patchFirst:y(point.weighted.firstBounce),patchSettled:y(point.weighted.outgoing),centerFirst:y(point.nearest.firstBounce),
      replayedPatchFirst:sumInitial(rays,'patch'),comparablePatchFirst:sumInitial(valid,'patch'),comparableExactFirst:sumInitial(valid,'exact')}
  })}))
  const feedbackRows=rows.filter(r=>r.kind==='feedback')
  const totals={...aggregate(rows),feedback:aggregate(feedbackRows),
    uniqueFeedback:aggregate([...new Map(feedbackRows.map(r=>[r.receiver+':'+r.launchNormal.join(',')+':'+r.j,r])).values()]),
    viewport:aggregate(rows.filter(r=>r.kind==='viewport')),
    regions:Object.fromEntries(world.grids.map(g=>[g.name,aggregate(rows.filter(r=>r.grid===g.name))])),
    strongestInitial,strongestSettled,thresholds:{coincidentMetres:.008,positionMetres:.01,normalDegrees:5,reflectance:.05},
    definitions:{terms:'Initial is outgoing solar, sky and exterior-ground radiance used in sweep 1. Settled adds both cached feedback sweeps. Later is the difference between settled and initial.',
      missing:'Exact hits without a valid cache match contribute no energy in the diagnostic render. Per-ray error distributions exclude these hits. Category energy shares include them with known patch energy only.',
      weighting:'Linear Rec.709 luma of each RGB source multiplied by receiver RGB reflectance divided by ray count. Energy shares use the mean of patch and exact contributions.',
      distance:'First-hit distance error measures rays that hit both representations. Normal error disregards winding; reversed winding is counted separately.',
      reuse:'Adjacent requests can map to the same cache patch. The unique feedback summary counts a patch, side and direction once.',
    }}
  return {totals,world:{...world,grids}}
}
