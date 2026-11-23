import {access,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const file=name=>fileURLToPath(new URL(name,folder))
const read=async name=>JSON.parse(await readFile(file(name+'.json'),'utf8'))
const before=await read('world-before')
const correctedName=process.argv[2]??'world-after'
const after=await read(correctedName).catch(error=>{if(error.code!=='ENOENT')throw error;return null})
const reference=(await read('world-reference').catch(error=>{if(error.code!=='ENOENT')throw error;return null}))?.reference
const patterns=(await read('world-patterns').catch(error=>{if(error.code!=='ENOENT')throw error;return null}))?.patterns
const components=['directSun','directSky','exteriorGround','firstBounce','laterBounce','outgoing']
const componentLabels=['Direct sunlight','Direct sky','Exterior ground','First bounce','Later bounces','Outgoing diffuse']
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null
const rms=a=>a.length?Math.sqrt(mean(a.map(x=>x*x))):null
const p95=a=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*.95))]:null
const max=a=>a.length?Math.max(...a):null

function numbers(grid,ref,get,oracle){
  const errors=[],changes=[[],[]],gradientErrors=[],patchJumps=[]
  const values=grid.points.map((p,i)=>{
    if(p.missing)return null
    const a=get(p,i),b=ref?.points[i]&&oracle(ref.points[i])
    if(a==null)return null
    if(b!=null)errors.push(a-b)
    for(const [d,axis] of [[1,0],[grid.width,1]]){
      if(axis===0&&i%grid.width===0)continue
      const q=grid.points[i-d]
      if(!q||q.missing||p.source!==q.source||p.material!==q.material)continue
      const previous=get(q,i-d),referencePrevious=ref?.points[i-d]&&oracle(ref.points[i-d])
      if(previous==null)continue
      const step=a-previous;changes[axis].push(Math.abs(step))
      if(q.id!==p.id)patchJumps.push(Math.abs(step))
      if(b!=null&&referencePrevious!=null)gradientErrors.push(step-(b-referencePrevious))
    }
    return a
  }).filter(x=>x!=null)
  return {samples:values.length,matched:errors.length,mean:mean(values),bias:mean(errors),rmse:rms(errors),p95AbsError:p95(errors.map(Math.abs)),
    gradientRMSE:rms(gradientErrors),maxDiscontinuity:max(changes.flat()),horizontalRMS:rms(changes[0]),verticalRMS:rms(changes[1]),
    horizontalP95:p95(changes[0]),verticalP95:p95(changes[1]),patchBoundaryP95:p95(patchJumps)}
}
function colour(value,limit){
  if(value==null)return [31,32,34]
  const x=Math.max(0,Math.min(1,value/Math.max(1e-8,limit)))
  return [Math.round(23+232*Math.min(1,x*1.7)),Math.round(26+215*Math.max(0,x*1.3-.3)),Math.round(61+114*(1-x)-55*x)]
}
async function heatmaps(grid,ref,prior,corrected){
  const cols=ref?3:2,px=5,w=grid.width*px,h=grid.height*px,tileW=Math.max(w,156),labelH=35,tiles=[]
  for(const [row,key] of components.entries()){
    const steps=[['Before',prior],['Corrected',corrected],['Triangle reference',ref]].filter(([,v])=>v)
    const values=steps.map(([title,g])=>[title,g.points.map(p=>p&&(p.interpolated??p)[key]?.[0])])
    const lim=Math.max(.001,p95(values.flatMap(([,v])=>v.filter(x=>x!=null)))??0)*1.1
    for(const [col,[title,data]] of values.entries()){
      const top=row*(h+labelH),left=col*tileW
      const input=await sharp(Buffer.from(data.flatMap(x=>colour(x,lim))),{raw:{width:grid.width,height:grid.height,channels:3}})
        .resize(w,h,{kernel:'nearest'}).png().toBuffer()
      const label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${labelH}" font-family="Arial" fill="white"><text x="4" y="14" font-size="11">${title}</text><text x="4" y="29" font-size="10">${componentLabels[row]} · 0–${lim.toFixed(4)}</text></svg>`)
      tiles.push({input,top:top+labelH,left:left+Math.floor((tileW-w)/2)},{input:label,top,left})
    }
  }
  await sharp({create:{width:cols*tileW,height:components.length*(h+labelH),channels:3,background:'#22262b'}}).composite(tiles).png().toFile(file(`world-heatmap-${grid.name}.png`))
}

const metrics={surfaces:{},patterns:{},screen:{}}
for(const [i,grid] of before.world.grids.entries()){
  const ref=reference?.grids[i],corrected=after?.world?.grids[i]
  const modes=[['nearest',grid],['interpolated',grid],['weighted',grid],['corrected',corrected]].filter(([,g])=>g)
  metrics.surfaces[grid.name]=Object.fromEntries(modes.map(([mode,g])=>[mode,Object.fromEntries(components.map(key=>[key,
    numbers(g,ref,p=>p[mode==='corrected'?'interpolated':mode]?.[key]?.[0],p=>p[key]?.[0])]))]))
  if(ref){
    const anchors=ref.points.filter(p=>p?.convergence)
    metrics.surfaces[grid.name].reference={anchors:anchors.length,meanRadianceSE:mean(anchors.map(p=>p.convergence.bounceStandardError[0])),
      repeatedRMSE:rms(anchors.map(p=>p.outgoing[0]-p.convergence.outgoing[0]))}
  }
  if(after)await heatmaps(grid,ref,grid,corrected)
  for(const pattern of patterns??[]){
    metrics.patterns[pattern.name]??={}
    const points=pattern.grids[i].points
    metrics.patterns[pattern.name][grid.name]=[
      numbers(grid,ref,(_,j)=>points[j]?.[0],p=>p.firstBounce[0]),
      numbers(grid,ref,(_,j)=>points[j]?.[2],p=>p.outgoing[0]),
      numbers(grid,ref,(_,j)=>points[j]?.[3],p=>p.outgoing[0]),
    ]
  }
}

const screens={left:{left:480,top:246,width:200,height:358},back:{left:764,top:210,width:295,height:381},
  ceiling:{left:690,top:8,width:280,height:96}}
const stages=['sky','ground','first-trace','later-trace','screen-trace','scene-trace','raw','spatialOnly','history','reconstructed','final']
const luma=(bytes,i)=>bytes[i]*.2126+bytes[i+1]*.7152+bytes[i+2]*.0722
for(const run of after?['world-before',correctedName]:['world-before']){
  metrics.screen[run]={}
  for(const [name,box] of Object.entries(screens)){
    metrics.screen[run][name]={}
    for(const stage of stages){
      const filename=file(`${run}-${stage}.png`),{width,height}=await sharp(filename).metadata()
      const image=width===1585&&height===934?filename:await sharp(filename).resize(1585,934,{kernel:'nearest'}).png().toBuffer()
      const bytes=await sharp(image).extract(box).removeAlpha().raw().toBuffer()
      const values=Array.from({length:bytes.length/3},(_,i)=>luma(bytes,3*i)),xs=[],ys=[]
      for(let y=0;y<box.height;y++)xs.push(mean(values.slice(y*box.width,(y+1)*box.width)))
      for(let x=0;x<box.width;x++)ys.push(mean(Array.from({length:box.height},(_,y)=>values[y*box.width+x])))
      const lineRMS=a=>rms(a.slice(8,-8).map((v,i)=>v-(a[i]+a[i+16])*.5))
      metrics.screen[run][name][stage]={mean:mean(values),verticalBands:lineRMS(ys),horizontalBands:lineRMS(xs)}
    }
  }
}

if(after){
  const freshReference=await access(file('world-path-reference.png')).then(()=>true,()=>false)
  const referenceImage=freshReference?'world-path-reference':'room-energy-reference'
  const box={left:0,top:0,width:1585,height:934}
  const regions={room:box,ceiling:{left:700,top:13,width:480,height:110},junction:{left:580,top:75,width:350,height:192},
    'left-wall':{left:460,top:245,width:235,height:350},'back-wall':{left:754,top:207,width:350,height:441},
    'patio-reveal':{left:1058,top:210,width:169,height:400}}
  for(const [name,area] of Object.entries(regions)){
    const inputs=await Promise.all(['world-before-final',correctedName+'-final',referenceImage].map(name=>sharp(file(name+'.png')).extract(area)
      .removeAlpha().resize(Math.min(520,area.width)).raw().toBuffer({resolveWithObject:true})))
    const {width,height}=inputs[0].info
    const delta=(a,b)=>Buffer.from(a.map((x,i)=>Math.min(255,4*Math.abs(x-b[i]))))
    const columns=[['Before',inputs[0].data],['Corrected',inputs[1].data],
      [freshReference?'Path trace':'Archived path trace',inputs[2].data],
      ['Before to corrected ×4',delta(inputs[0].data,inputs[1].data)],
      ['Corrected to reference ×4',delta(inputs[1].data,inputs[2].data)]]
    const tiles=[]
    for(const [i,[label,data]] of columns.entries()){
      const banner=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><text x="4" y="16" font-family="Arial" font-size="13" fill="white">${label}</text></svg>`)
      tiles.push({input:banner,left:i*width,top:0},{input:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),left:i*width,top:22})
    }
    await sharp({create:{width:columns.length*width,height:height+22,channels:3,background:'#22262b'}}).composite(tiles).png().toFile(file(`world-match-${name}.png`))
  }
}
await writeFile(file('world-metrics.json'),JSON.stringify(metrics,null,2))
