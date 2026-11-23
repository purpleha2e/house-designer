import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {Matrix4,Vector3} from 'three'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const file=name=>fileURLToPath(new URL(name,folder))
const json=async name=>JSON.parse(await readFile(file(name+'.json'),'utf8'))
const report=await json('visibility'),world=await json('visibility-world')
const {width,height,camera,projection}=report.views['visibility-a-patches']
const matrix=new Matrix4().fromArray(projection).multiply(new Matrix4().fromArray(camera).invert())
const filenames=['visibility-a-patches','visibility-b-exact','visibility-b-exact-feedback',report.reference.file.replace('.png',''),'visibility-a-restored']
const images=await Promise.all(filenames.map(name=>sharp(file(name+'.png')).removeAlpha().raw().toBuffer({resolveWithObject:true})))
assert.ok(images.every(image=>image.info.width===width&&image.info.height===height&&image.info.channels===3))
const luma=(p,i)=>p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722
const [A,B,F,C,R]=images.map(image=>Float32Array.from({length:width*height},(_,i)=>luma(image.data,3*i)))
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0
const rms=a=>Math.sqrt(mean(a.map(x=>x*x)))
const p95=a=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*.95))]??0
const metrics={}
const regions={
  room:{left:0,top:0,width,height},
  'left-wall':{left:460,top:245,width:235,height:350},
  'back-wall':{left:754,top:207,width:350,height:441},
  ceiling:{left:700,top:13,width:480,height:110},
  junction:{left:580,top:75,width:350,height:192},
  'patio-reveal':{left:1058,top:210,width:169,height:400},
  'flat-left':{left:480,top:246,width:200,height:358},
  'flat-back':{left:764,top:210,width:295,height:381},
  'flat-ceiling':{left:690,top:8,width:280,height:96},
}

function comparison(values,reference,box){
  const signed=[],gradient=[],local=[],horizontal=new Float64Array(box.height),vertical=new Float64Array(box.width)
  for(let y=0;y<box.height;y++){
    for(let x=0;x<box.width;x++){
      const i=(y+box.top)*width+x+box.left,v=values[i]
      const error=v-reference[i]
      signed.push(error)
      horizontal[y]+=v/box.width
      vertical[x]+=v/box.height
      for(const step of [x?1:0,y?width:0]){
        if(!step)continue
        local.push(Math.abs(v-values[i-step]))
        gradient.push(error-(values[i-step]-reference[i-step]))
      }
    }
  }
  const band=values=>rms(values.slice(8,-8).map((v,i)=>v-(values[i]+values[i+16])*.5))
  return {luma:mean(horizontal),bias:mean(signed),mae:mean(signed.map(Math.abs)),rmse:rms(signed),p95Abs:p95(signed.map(Math.abs)),
    gradientRMSE:rms(gradient),p95LocalStep:p95(local),verticalBands:band(vertical),horizontalBands:band(horizontal)}
}

function pixels(values,reference,gain=4){
  const result=Buffer.alloc(values.length*3)
  for(let i=0;i<values.length;i++){
    const x=Math.min(255,Math.abs(values[i]-reference[i])*gain)
    result.fill(Math.round(x),i*3,i*3+3)
  }
  return result
}

const writePng=(bytes,name)=>sharp(bytes,{raw:{width,height,channels:3}}).png().toFile(file(name+'.png'))
await Promise.all([
  writePng(pixels(A,C),'visibility-a-vs-reference'),
  writePng(pixels(B,C),'visibility-b-vs-reference'),
  writePng(pixels(F,C),'visibility-b-feedback-vs-reference'),
  writePng(pixels(B,A,12),'visibility-trace-difference'),
  writePng(pixels(F,A,12),'visibility-feedback-difference'),
])

const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;')
const banner=(title,w,h)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#242831"/><text x="8" y="17" font-family="Arial" font-size="13" fill="white">${escape(title)}</text></svg>`)
const samples=[
  ['A · Bounded patches',images[0].data],['B · Exact view hits',images[1].data],
  ['B · Exact view and feedback hits',images[2].data],['C · Path-traced reference',images[3].data],
  ['A vs reference (4× luma)',pixels(A,C)],['B vs reference (4× luma)',pixels(B,C)],
  ['Exact view vs A (12× luma)',pixels(B,A,12)],['Exact view and feedback vs A (12× luma)',pixels(F,A,12)],
]
for(const [name,box] of Object.entries(regions)){
  metrics[name]={patches:comparison(A,C,box),exact:comparison(B,C,box),exactFeedback:comparison(F,C,box),
    reference:comparison(C,C,box),exactChange:comparison(B,A,box),feedbackChange:comparison(F,A,box),
    restoredChange:comparison(R,A,box)}
  if(name.startsWith('flat-'))continue
  const tileWidth=name==='room'?470:Math.min(530,Math.floor(box.width*1.6)),tileHeight=Math.round(tileWidth*box.height/box.width),rowHeight=tileHeight+25
  const tiles=await Promise.all(samples.map(async([label,data],index)=>{
    const left=index%4*tileWidth,top=Math.floor(index/4)*rowHeight
    const input=await sharp(data,{raw:{width,height,channels:3}}).extract(box).resize(tileWidth,tileHeight).png().toBuffer()
    return [{input:banner(label,tileWidth,25),left,top},{input,left,top:top+25}]
  }))
  await sharp({create:{width:4*tileWidth,height:2*rowHeight,channels:3,background:'#242831'}}).composite(tiles.flat())
    .png().toFile(file('visibility-compare-'+name+'.png'))
}

const maps=[
  ['hitMiss','Hit or miss disagreement',1],['distance','Maximum first-hit distance error (cm)',.25],
  ['normalAngle','Maximum normal error (degrees)',90],['material','Material identity disagreement',1],
  ['visibility','Visibility or wrong nearest surface',1],['first','First feedback sweep luma error',.04],
  ['later','Later feedback luma error',.015],['total','Settled secondary luma error',.045],['unmapped','Exact hit without comparable radiance',1],
]
const pixelsOnRoom=world.grids.flatMap(grid=>grid.points.filter(p=>!p.missing&&p.visible!==false).map(p=>{
  const v=new Vector3().fromArray(p.position).applyMatrix4(matrix)
  return {x:Math.round((v.x+1)*width*.5),y:Math.round((1-v.y)*height*.5),...p,grid:grid.name,hidden:Math.abs(v.z)>1,step:grid.step}
})).filter(p=>!p.hidden&&p.x>=4&&p.x<width-4&&p.y>=4&&p.y<height-4)
const range={
  left:regions['flat-left'],'left-fine':regions['flat-left'],back:regions['flat-back'],
  ceiling:regions['flat-ceiling'],'ceiling-fine':regions['flat-ceiling'],
}
function correlation(samples){
  const x=mean(samples.map(p=>p[0])),y=mean(samples.map(p=>p[1]))
  const cov=mean(samples.map(p=>(p[0]-x)*(p[1]-y)))
  const norm=rms(samples.map(p=>p[0]-x))*rms(samples.map(p=>p[1]-y))
  return {count:samples.length,r:norm?cov/norm:null}
}
const correlations={}
const firstSweep={}
for(const grid of world.grids){
  const stepsA=[],stepsB=[],atlasError=[]
  for(const [i,p] of grid.points.entries()){
    if(p.missing)continue
    atlasError.push(Math.abs(p.centerFirst-p.replayedPatchFirst))
    if(p.unmapped)continue
    for(const offset of [i%grid.width?1:0,grid.width]){
      if(!offset)continue
      const neighbor=grid.points[i-offset]
      if(!neighbor||neighbor.missing||neighbor.unmapped)continue
      stepsA.push(Math.abs(p.comparablePatchFirst-neighbor.comparablePatchFirst))
      stepsB.push(Math.abs(p.comparableExactFirst-neighbor.comparableExactFirst))
    }
  }
  firstSweep[grid.name]={comparableEdges:stepsA.length,p95PatchStep:p95(stepsA),p95ExactStep:p95(stepsB),
    p95PatchReplayAtlasError:p95(atlasError),p95ExactDelta:p95(grid.points.filter(p=>!p.missing&&!p.unmapped).map(p=>Math.abs(p.firstSigned)))}
}
const residual=(image,x,y,dx,dy)=>image[y*width+x]-(image[(y-dy)*width+x-dx]+image[(y+dy)*width+x+dx])*.5
const tiles=[]
for(const [index,[key,title,limit]] of maps.entries()){
  const values=new Float32Array(width*height),known=new Uint8Array(values.length)
  for(const p of pixelsOnRoom){
    const radius=p.step===.05?2:3
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx**2+dy**2>radius**2)continue
      const i=width*(p.y+dy)+p.x+dx
      values[i]=Math.max(values[i],p[key])
      known[i]=1
    }
  }
  const result=Buffer.from(images[0].data)
  for(let i=0;i<values.length;i++){
    if(!known[i])continue
    const t=Math.sqrt(Math.min(1,values[i]/limit)),alpha=t>0?.88:.46
    const c=[34+t*221,165-110*t,204-175*t]
    for(let k=0;k<3;k++)result[3*i+k]=Math.round((1-alpha)*result[3*i+k]+alpha*c[k])
  }
  await writePng(result,'visibility-map-'+key)
  const left=index%3*520,top=Math.floor(index/3)*333
  const input=await sharp(result,{raw:{width,height,channels:3}}).resize(520,307).png().toBuffer()
  const maximum=key==='distance'?limit*100:limit
  tiles.push({input:banner(title+' · 0–'+maximum,520,26),top,left},{input,top:top+26,left})
  correlations[key]={}
  for(const [name,box] of Object.entries(range)){
    const points=pixelsOnRoom.filter(p=>p.grid===name&&p.x>=box.left+8&&p.x<box.left+box.width-8&&p.y>=box.top+8&&p.y<box.top+box.height-8)
    const highPass=(image,p)=>Math.abs(residual(image,p.x,p.y,8,0))+(name.startsWith('ceiling')?Math.abs(residual(image,p.x,p.y,0,8)):0)
    correlations[key][name]={
      patchBanding:correlation(points.map(p=>[p[key],highPass(A,p)])),
      visibilityImageChange:correlation(points.map(p=>[p[key],Math.abs(F[p.y*width+p.x]-A[p.y*width+p.x])])),
      referenceResidualBanding:correlation(points.map(p=>[p[key],Math.abs(highPass(A,p)-highPass(C,p))])),
    }
  }
}
await sharp({create:{width:1560,height:999,channels:3,background:'#242831'}}).composite(tiles).png().toFile(file('visibility-heatmaps.png'))
await writeFile(file('visibility-image-metrics.json'),JSON.stringify({metrics,correlations,firstSweep,regions,
  method:'Rec.709 luma applied to captured 8-bit display RGB. Banding is the RMS high-pass of column or row means, sampled 8 pixels from the center. Reference gradients include its native scale, authored materials and shadows.',
  maps:'World receiver values projected with the saved camera. Cyan marks sampled zero, red approaches the labelled maximum. Distance and normal maps show the worst ray over a receiver. Lighting maps sum unsigned per-ray feedback contribution differences, excluding exact hits without cache matches.'},null,2))
