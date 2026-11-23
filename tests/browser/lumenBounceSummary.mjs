import {access,readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {Matrix4,Vector3} from 'three'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const file=name=>fileURLToPath(new URL(name,folder))
const exists=name=>access(file(name)).then(()=>true,()=>false)
const json=async name=>JSON.parse(await readFile(file(name+'.json')))
const gzip=async name=>JSON.parse(gunzipSync(await readFile(file(name+'.json.gz'))))
const readImage=name=>sharp(file(name+'.png')).removeAlpha().raw().toBuffer({resolveWithObject:true})
const terms=['directSun','directSky','exteriorGround','firstBounce','laterBounce','outgoing']
const base='bounce-study',after=process.argv[2]??'bounce-after'
const study=await json(base)
const reviewed=await exists(after+'-final.png')
const oldReference=(await json('world-reference')).reference.grids
const reference=await exists('bounce-reference.json')?await json('bounce-reference'):null
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null
const rms=a=>a.length?Math.sqrt(mean(a.map(x=>x*x))):null
const p95=a=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(.95*a.length))]:null
const luma=p=>.2126*p[0]+.7152*p[1]+.0722*p[2]
const add=(a,b)=>a.map((x,i)=>x+b[i])
const minus=(a,b)=>a.map((x,i)=>x-b[i])
const range=[['feedback-8x4',1,2,3,4],['feedback-32x2',2],['feedback-32x8',8],['feedback-targeted',2],
  ['ground-open',2],['ground-fixed',2],['ground-sky16',2],['ground-tiles6',2]]
const specs=[['baseline',base+'-world',base+'-final']]
for(const [name,...sweeps] of range)for(const order of sweeps){
  const arm=base+'-'+name+'-'+order
  if(await exists(arm+'.json.gz'))specs.push([name+'-'+order,arm,await exists(arm+'.png')?arm:null])
}
for(const run of ['bounce-candidates','bounce-budget','bounce-orders']){
  if(!await exists(run+'.json'))continue
  const control=await json(run)
  for(const {name} of control.arms??[]){
    const arm=run+'-'+name+'-2'
    if(await exists(arm+'.json.gz'))specs.push([name,arm,await exists(arm+'.png')?arm:null])
  }
}
if(reviewed)specs.push(['corrected',after+'-world',after+'-final'])
const grids=new Map()
for(const [name,world] of specs)grids.set(name,await gzip(world))
const better=grids.get('corrected')??grids.get('baseline')
const exactGround={}
for(const name of ['ceiling','ceiling-fine']){
  const target='bounce-ground-reference-'+name
  if(await exists(target+'.json.gz'))exactGround[name]=await gzip(target)
}

function spatial(grid,ref,receiver,oracle){
  const values=[],errors=[],gradients=[[],[]],variation=[[],[]]
  for(const [i,p] of grid.points.entries()){
    if(!p)continue
    const a=receiver(p)
    const b=ref?.points[i]&&oracle(ref.points[i])
    if(!Number.isFinite(a))continue
    values.push(a)
    if(Number.isFinite(b))errors.push(a-b)
    for(const [axis,offset] of [1,grid.width].entries()){
      if(!axis&&i%grid.width===0)continue
      const q=grid.points[i-offset],r=ref?.points[i-offset]
      if(!q||q.source!==p.source||q.material!==p.material)continue
      const step=a-receiver(q)
      variation[axis].push(Math.abs(step))
      if(Number.isFinite(b)&&r)gradients[axis].push(step-b+oracle(r))
    }
  }
  return {points:values.length,matched:errors.length,mean:mean(values),bias:mean(errors),rmse:rms(errors),p95AbsError:p95(errors.map(Math.abs)),
    gradientRMSE:rms(gradients.flat()),horizontalGradientRMSE:rms(gradients[0]),verticalGradientRMSE:rms(gradients[1]),
    horizontalStepP95:p95(variation[0]),verticalStepP95:p95(variation[1])}
}

const world={}
for(const [name,arm] of grids){
  world[name]={}
  for(const grid of arm){
    const old=oldReference.find(g=>g.name===grid.name)
    const term=Object.fromEntries(terms.map((key,i)=>[key,spatial(grid,old,p=>p.values[i][0],p=>p[key][0])]))
    const irradiance=spatial(grid,old,p=>p.values[5][0]*Math.PI/Math.max(p.rho[0],1e-8),p=>p.incoming[0])
    const exterior=exactGround[grid.name]
    world[name][grid.name]={...term,irradiance,...(exterior&&{
      geometryGroundSky:spatial(grid,exterior,p=>p.values[2][0],p=>p.sky[0]),
      geometryGroundTotal:spatial(grid,exterior,p=>p.values[2][0],p=>p.ground[0]),
      geometryGroundIrradiance:spatial(grid,exterior,p=>p.values[2][0]*Math.PI/Math.max(p.rho[0],1e-8),p=>p.irradianceSky[0]),
    })}
  }
}

const feedbackRuns=[1,2,3,4].map(order=>grids.get('feedback-8x4-'+order))
const energy={}
if(feedbackRuns.every(Boolean)){
  for(const [i,grid] of feedbackRuns[0].entries()){
    const volume=feedbackRuns.map(run=>run[i].points.map(p=>p?add(p.values[3],p.values[4]):null))
    const order=volume.map((values,j)=>values.flatMap((v,k)=>v&&(!j||volume[j-1][k])?[j?minus(v,volume[j-1][k]):v]:[]))
    energy[grid.name]={increments:order.map(values=>[0,1,2].map(c=>mean(values.map(v=>v[c])))),
      nonMonotoneChannels:order.map(values=>values.reduce((n,v)=>n+v.filter(x=>x<-.00002).length,0))}
  }
}

// Use the measured generation 2 / generation 1 ratio per channel on a
// separate wall-and-ceiling sample. Apply the approximation to every grid.
const baseline=grids.get('baseline')
const covered=[...new Map(baseline.filter(g=>['left','back','ceiling'].includes(g.name))
  .flatMap(g=>g.points.filter(Boolean).map(p=>[p.id,p]))).values()]
const retention=[0,1,2].map(c=>covered.reduce((sum,p)=>sum+p.nearest[4][c],0)/covered.reduce((sum,p)=>sum+p.nearest[3][c],0))
const predicted=baseline.map(g=>({...g,points:g.points.map(p=>{
  if(!p)return null
  const next=p.values[4].map((x,i)=>x*(retention[i]>=0&&retention[i]<1?retention[i]:0))
  const values=p.values.map((v,i)=>i===4||i===5?add(v,next):v)
  return {...p,values}
})}))
const reuse={retention,patchCount:covered.length,areas:{}}
for(const g of predicted){
  const ref=oldReference.find(r=>r.name===g.name)
  const firstActual=grids.get('feedback-8x4-3')?.find(a=>a.name===g.name)
  const converged=grids.get('feedback-32x8-8')?.find(a=>a.name===g.name)
  const control=firstActual&&{points:firstActual.points.map((p,i)=>p&&baseline.find(b=>b.name===g.name).points[i]?p:null)}
  reuse.areas[g.name]={later:spatial(g,ref,p=>p.values[4][0],p=>p.laterBounce[0]),
    relativeToReplayThree:spatial(g,control,p=>p.values[4][0],p=>p.values[4][0]),
    relativeToOfflineConvergence:spatial(g,converged,p=>p.values[4][0],p=>p.values[4][0])}
}

const anchors=reference?.anchors.map(row=>{
  const grid=baseline.find(g=>g.name===row.plane),i=grid.points.findIndex(p=>p&&p.p.every((x,j)=>x===row.requested[j]))
  const matching=name=>grids.get(name)?.find(g=>g.name===row.plane)?.points[i]
  const inputs=Object.fromEntries(['baseline','feedback-8x4-3','feedback-8x4-4','feedback-32x8-8','corrected']
    .map(name=>[name,matching(name)?.values??null]))
  const resolvedOrders=Object.fromEntries(['baseline','corrected'].flatMap(name=>{
    const wet=matching(name),dry=matching(name+'-no-ground-seed')
    if(!wet||!dry)return []
    const one=dry.values[3],two=add(dry.values[4],minus(wet.values[3],dry.values[3])),three=minus(wet.values[4],dry.values[4])
    const radiance={directSun:wet.values[0],directSky:wet.values[1],exteriorTerrainSky:wet.values[2],one,two,three}
    const irradiance=Object.fromEntries(Object.entries(radiance).map(([key,v])=>[key,v.map((x,i)=>x*Math.PI/Math.max(wet.rho[i],1e-9))]))
    return [[name,{radiance,irradiance}]]
  }))
  const separated=row.runs.map(r=>({
    directSun:r.radiance.directSun,directSky:r.radiance.orders[0].sky,
    firstDiffuse:minus(add(r.radiance.orders[1].sky,r.radiance.orders[1].solar),r.radiance.orders[1].terrain),
    ground:r.radiance.orders[1].terrain,second:r.radiance.orders[2]&&add(r.radiance.orders[2].sky,r.radiance.orders[2].solar),
    third:add(r.radiance.orders[3].sky,r.radiance.orders[3].solar),
    rest:r.radiance.orders.slice(4).reduce((sum,o)=>add(sum,add(o.sky,o.solar)),[0,0,0]),
  }))
  return {...row,inputs,resolvedOrders,referenceTerms:separated}
})

const regions={
  room:{left:0,top:0,width:1585,height:934},ceiling:{left:690,top:8,width:280,height:96},
  left:{left:480,top:246,width:200,height:358},back:{left:764,top:210,width:295,height:381},
  junction:{left:580,top:75,width:350,height:192},reveal:{left:1058,top:210,width:169,height:400},
  floor:{left:570,top:646,width:410,height:246},
}
const frames=new Map()
for(const [name,,image] of specs)if(image)frames.set(name,await readImage(image))
frames.set('pathReference',await readImage('world-path-reference'))
for(const name of ['sky','ground','first','later'])frames.set('without-'+name,await readImage(base+'-without-'+name))
const toFloat=image=>Float32Array.from({length:1585*934},(_,i)=>luma(image.data.subarray(i*3,i*3+3)))
const plane=new Map([...frames].map(([name,image])=>[name,toFloat(image)]))
const imageMetrics={}
for(const [name,arm] of plane){
  const raw=plane.get('pathReference'),start=plane.get('baseline')
  imageMetrics[name]={}
  for(const [region,box] of Object.entries(regions)){
    const err=[],change=[],grad=[],absGrad=[],smoothed=[]
    const xs=new Float64Array(box.width),ys=new Float64Array(box.height)
    for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){
      const i=(box.top+y)*1585+box.left+x
      err.push(arm[i]-raw[i])
      change.push(Math.abs(arm[i]-start[i]))
      ys[y]+=arm[i]/box.width
      xs[x]+=arm[i]/box.height
      for(const delta of [x?1:0,y?1585:0]){
        if(!delta)continue
        grad.push((arm[i]-arm[i-delta])-(raw[i]-raw[i-delta]))
        absGrad.push(Math.abs(arm[i]-arm[i-delta]))
      }
      if(x%5===0&&y%5===0&&x+4<box.width&&y+4<box.height){
        let sum=0
        for(let ky=0;ky<5;ky++)for(let kx=0;kx<5;kx++)sum+=arm[i+ky*1585+kx]-raw[i+ky*1585+kx]
        smoothed.push(Math.abs(sum)/25)
      }
    }
    const band=values=>rms(Array.from(values.slice(8,-8),(v,i)=>v-(values[i]+values[i+16])*.5))
    imageMetrics[name][region]={meanLuma:mean(ys),mae:mean(err.map(Math.abs)),bias:mean(err),p95:p95(err.map(Math.abs)),deltaMAE:mean(change),
      gradientRMSE:rms(grad),localStepP95:p95(absGrad),smoothedMAE:mean(smoothed),verticalBands:band(xs),horizontalBands:band(ys)}
  }
}

const png=(buffer,w,h)=>sharp(buffer,{raw:{width:w,height:h,channels:3}})
const colour=(value,limit)=>{
  if(!Number.isFinite(value))return[24,28,34]
  const f=Math.sqrt(Math.max(0,Math.min(1,value/limit)))
  return [Math.round(24+231*f),Math.round(65+145*f),Math.round(120-89*f)]
}
const banner=(label,w,h=24)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#232831"/><text x="8" y="17" font-family="Arial" font-size="13" fill="white">${label}</text></svg>`)
async function gridPlot(grid,read,limit){
  const tile=9,w=grid.width*tile,h=grid.height*tile
  const output=Buffer.alloc(w*h*3)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const col=Math.floor(x/tile),row=Math.floor(y/tile),i=row*grid.width+col,p=grid.points[i]
    const boundary=p&&((col>0&&x%tile===0&&grid.points[i-1]?.id!==p.id)||(row>0&&y%tile===0&&grid.points[i-grid.width]?.id!==p.id))
    output.set(boundary?[19,30,47]:colour(p?read(p,i):null,limit),(y*w+x)*3)
  }
  return png(output,w,h).png().toBuffer()
}

const {camera,projection}=study.views[base+'-final']
const clip=new Matrix4().fromArray(projection).multiply(new Matrix4().fromArray(camera).invert())
const projected=(p,image)=>{
  const v=new Vector3().fromArray(p.p).applyMatrix4(clip)
  if(v.toArray().some(a=>Math.abs(a)>=1))return null
  return image[Math.floor((1-v.y)*.5*934)*1585+Math.floor((1+v.x)*.5*1585)]/255
}
for(const name of ['ceiling','ceiling-fine']){
  const initial=baseline.find(g=>g.name===name),final=better.find(g=>g.name===name)
  const fields=[
    ['Direct sky',p=>luma(p.values[1])],['Exterior-ground sky',p=>luma(p.values[2])],
    ['First feedback sweep',p=>luma(p.values[3])],['Later diffuse feedback',p=>luma(p.values[4])],
    ['Combined indirect',p=>luma(minus(p.values[5],p.values[0]))],
    ['Final display luma',p=>projected(p,plane.get('baseline')),p=>projected(p,plane.get('corrected')??plane.get('baseline'))],
  ]
  const width=initial.width*9,height=initial.height*9,rowHeight=height+24,items=[]
  for(const [row,[label,oldValue,newValue=oldValue]] of fields.entries()){
    const top=row*rowHeight,values=[...initial.points.filter(Boolean).map(oldValue),...final.points.filter(Boolean).map(newValue)].filter(Number.isFinite)
    const maximum=Math.max(.001,(p95(values)??0)*1.12)
    for(const [i,grid] of [initial,final].entries()){
      const left=i*width+0,labelled=(i?(reviewed?'Corrected':'Baseline control'):'Baseline')+' · '+label+' · 0–'+maximum.toFixed(4)
      items.push({input:banner(labelled,width),left,top},{input:await gridPlot(grid,i?newValue:oldValue,maximum),left,top:top+24})
    }
  }
  await sharp({create:{width:width*2,height:fields.length*rowHeight,channels:3,background:'#232831'}}).composite(items)
    .png().toFile(file('bounce-map-'+name+'-terms.png'))
  if(exactGround[name]){
    const ref=exactGround[name]
    const max=Math.max(.001,(p95(ref.points.filter(Boolean).map(p=>luma(p.sky)))??0)*1.12)
    const cross=[
      ['Baseline exterior-ground sky',initial,p=>luma(p.values[2])],['Triangle ground sky',ref,p=>luma(p.sky)],
      ['Corrected exterior-ground sky',final,p=>luma(p.values[2])],['Triangle ground sun',ref,p=>luma(p.solar)],
    ]
    const images=[]
    for(const [i,[label,grid,get]] of cross.entries()){
      const left=i%2*width,top=Math.floor(i/2)*rowHeight
      images.push({input:banner(label+' · 0–'+max.toFixed(4),width),left,top},
        {input:await gridPlot(grid,get,max),left,top:top+24})
    }
    await sharp({create:{width:width*2,height:rowHeight*2,channels:3,background:'#232831'}}).composite(images)
      .png().toFile(file('bounce-map-'+name+'-ground-reference.png'))
    const irradiance=p=>luma(p.values[2].map((x,i)=>x*Math.PI/Math.max(p.rho[i],1e-8)))
    const limit=Math.max(.001,(p95(ref.points.filter(Boolean).map(p=>luma(p.irradianceSky)))??0)*1.12)
    const maps=[
      ['Baseline ground irradiance',initial,irradiance],
      ['Corrected ground irradiance',final,irradiance],
      ['Triangle ground-sky irradiance',ref,p=>luma(p.irradianceSky)],
    ]
    const plot=[]
    for(const [i,[label,grid,get]] of maps.entries()){
      const left=i*width
      plot.push({input:banner(label+' · 0–'+limit.toFixed(4),width),left,top:0},
        {input:await gridPlot(grid,get,limit),left,top:24})
    }
    await sharp({create:{width:3*width,height:rowHeight,channels:3,background:'#232831'}}).composite(plot).png()
      .toFile(file('bounce-map-'+name+'-ground-irradiance.png'))
    if(name==='ceiling-fine'){
      const across=Array.from({length:initial.width},(_,i)=>Math.floor(initial.height/2)*initial.width+i)
      const down=Array.from({length:initial.height},(_,i)=>i*initial.width+Math.floor(initial.width/2))
      const colours=['#3471b8','#c97924','#283a39'],w=950,h=460
      const words='font-family="Arial"'
      const panels=[['Left to right, fixed depth',across,0],['Front to back, fixed horizontal position',down,2]]
      const notes=panels.map(([label,indices,axis],i)=>{
        const left=70+i*450,top=85,height=280,width=379
        const series=maps.map(([,grid,get])=>indices.map(idx=>grid.points[idx]?get(grid.points[idx]):null))
        const vmax=1.07*Math.max(...series.flat().filter(Number.isFinite))
        const lines=series.map((values,n)=>{
          const points=values.map((v,k)=>v==null?null:[left+k*width/(indices.length-1),top+height-height*v/vmax]).filter(Boolean).map(p=>p.join(',')).join(' ')
          return `<polyline points="${points}" fill="none" stroke="${colours[n]}" stroke-width="2.3"/>`
        }).join('')
        const labels=indices.filter((_,k)=>k===0||k===Math.floor(indices.length/2)||k===indices.length-1).map(idx=>{
          const v=ref.points[idx]?.position[axis],x=left+indices.indexOf(idx)*width/(indices.length-1)
          return v==null?'':`<text x="${x}" y="${top+height+20}" text-anchor="middle">${v.toFixed(2)} m</text>`
        }).join('')
        const grid=Array.from({length:6},(_,k)=>{
          const y=top+height-height*k/5
          return `<path d="M${left},${y} h${width}" stroke="#dce1e3"/><text x="${left-9}" y="${y+4}" text-anchor="end">${(vmax*k/5).toFixed(3)}</text>`
        }).join('')
        return `<text x="${left}" y="${top-18}" font-size="15">${label}</text>${grid}${labels}${lines}`
      }).join('')
      const legend=['Baseline','Corrected','Triangle ground sky'].map((v,i)=>`<text fill="${colours[i]}" x="${420+145*i}" y="425">${v}</text>`).join('')
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ${words} font-size="12" fill="#1a2933"><rect width="100%" height="100%" fill="#fff"/><text x="70" y="34" font-size="20">Ceiling ground irradiance along two 5 cm strips</text>${notes}${legend}</svg>`
      await sharp(Buffer.from(svg)).png().toFile(file('bounce-ceiling-irradiance-strips.png'))
    }
  }
}

const a=plane.get('baseline'),b=plane.get('corrected')??a,c=plane.get('pathReference')
const diff=(x,y,gain)=>{
  const output=Buffer.alloc(x.length*3)
  for(let i=0;i<x.length;i++)output.fill(Math.min(255,Math.round(Math.abs(x[i]-y[i])*gain)),3*i,3*i+3)
  return output
}
const differences=[diff(a,c,4),diff(b,c,4),diff(b,a,12)]
for(const [i,name] of ['before-reference','after-reference','after-before'].entries()){
  await png(differences[i],1585,934).png().toFile(file('bounce-'+name+'.png'))
}
for(const [name,box] of Object.entries(regions)){
  const w=name==='room'?470:Math.min(530,Math.round(box.width*1.7)),h=Math.round(w/box.width*box.height),tiles=[]
  const content=[['Baseline',frames.get('baseline').data],[reviewed?'Corrected':'Baseline control',(frames.get('corrected')??frames.get('baseline')).data],
    ['Path trace',frames.get('pathReference').data],['Baseline vs path trace ×4',differences[0]],['Corrected vs path trace ×4',differences[1]],['Change ×12',differences[2]]]
  for(const [i,[label,data]] of content.entries()){
    const left=i%3*w,top=Math.floor(i/3)*(h+24)
    const input=await png(data,1585,934).extract(box).resize(w,h).png().toBuffer()
    tiles.push({input:banner(label,w),top,left},{input,top:top+24,left})
  }
  await sharp({create:{width:w*3,height:(h+24)*2,channels:3,background:'#232831'}}).composite(tiles).png()
    .toFile(file('bounce-compare-'+name+'.png'))
}

const components=[['Direct sky','sky'],['Exterior-ground sky','ground'],['First geometry bounce','first'],
  ['Later geometry and terrain paths','later'],['Indirect at normal exposure','indirect'],['Final at normal exposure','final']]
const componentTiles=[]
for(const [i,[label,term]] of components.entries()){
  for(const [column,run] of [base,reviewed?after:base].entries()){
    const left=(i%3*2+column)*260,top=Math.floor(i/3)*177
    const input=await sharp(file(run+'-'+term+'.png')).resize(260,153).png().toBuffer()
    componentTiles.push({input:banner((column?'Corrected':'Baseline')+' · '+label,260),top,left},{input,top:top+24,left})
  }
}
await sharp({create:{width:1560,height:354,channels:3,background:'#232831'}}).composite(componentTiles).png()
  .toFile(file('bounce-lighting-components.png'))

const convergence=Object.fromEntries(Object.entries(exactGround).map(([name,g])=>{
  const rows=g.points.filter(p=>p?.convergence),differences=rows.map(p=>p.sky[0]-p.convergence.sky[0])
  return [name,{matched:rows.length,apertureTiles:g.tiles,skyRaysPerTerrainHit:g.skySamples,
    quadratures:g.quadratures,holdout:[g.convergenceTiles,g.convergenceSkySamples,g.convergenceQuadratures],
    meanDifference:mean(differences),rmse:rms(differences),p95:p95(differences.map(Math.abs))}]
}))
await writeFile(file('bounce-metrics.json'),JSON.stringify({terms,world,images:imageMetrics,energy,reuse,anchors,convergence},null,2))
