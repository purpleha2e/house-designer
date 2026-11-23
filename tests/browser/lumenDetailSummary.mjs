import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {Matrix4,Vector3} from 'three'
import {detailCrops} from './lumenResolutionAudit.mjs'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const file=name=>fileURLToPath(new URL(name,folder))
const cropBox=({x,y,width,height})=>({left:x,top:y,width,height})
const luminance=(rgb,i)=>rgb[i]*.2126+rgb[i+1]*.7152+rgb[i+2]*.0722
const difference=(a,b)=>Math.abs(a-b)
const mean=(values)=>values.reduce((total,value)=>total+value,0)/values.length
const rms=(values)=>Math.sqrt(mean(values.map(value=>value**2)))
const averageAbsolute=(a,b)=>mean(a.map((value,i)=>difference(value,b[i])))
const rgb=async buffer=>sharp(buffer).removeAlpha().toColourspace('srgb').raw().toBuffer()
const luma=buffer=>Array.from({length:buffer.length/3},(_,i)=>luminance(buffer,i*3))
const crop=async(name,box)=>sharp(file(name+'.png')).extract(cropBox(box)).png().toBuffer()
const filtered=async(buffer,sigma)=>luma(await sharp(buffer).blur(sigma).removeAlpha().toColourspace('srgb').raw().toBuffer())
const gradients=(pixels,width)=>pixels.flatMap((value,i)=>{
  const result=[]
  if(i%width)result.push(value-pixels[i-1])
  if(i>=width)result.push(value-pixels[i-width])
  return result
})
const spatial=async(buffer,low,high)=>{
  const first=low?await filtered(buffer,low):luma(await rgb(buffer))
  const broad=await filtered(buffer,high)
  return first.map((value,i)=>value-broad[i])
}

async function comparisonSheet(name,box,before,after,reference){
  const {width,height}=box, header=24
  const residual=Buffer.from((await rgb(after)).map((value,i)=>Math.min(255,4*difference(value,reference[i]))))
  const panels=[before,after,await sharp(reference,{raw:{width,height,channels:3}}).png().toBuffer(),
    await sharp(residual,{raw:{width,height,channels:3}}).png().toBuffer()]
  const tiles=[]
  for(const [i,label] of ['Before','Corrected','Native path trace','Absolute difference ×4'].entries()){
    const banner=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${header}"><text x="6" y="16" fill="white" font-size="13" font-family="Arial">${label}</text></svg>`)
    tiles.push({input:panels[i],left:i*width,top:header},{input:banner,left:i*width,top:0})
  }
  await sharp({create:{width:width*4,height:height+header,channels:3,background:'#222'}}).composite(tiles).png().toFile(file(`detail-match-${name}.png`))
}

const results={crops:{},settings:{}}
for(const [name,box] of Object.entries(detailCrops)){
  const before=await crop('detail-before-final',box),after=await crop('detail-after-final',box)
  const reference=await readFile(file(`detail-reference-${name}.png`))
  await comparisonSheet(name,box,before,after,await rgb(reference))
  const stages=await Promise.all([before,after,reference].map(buffer=>filtered(buffer,2)))
  const edges=await Promise.all([before,after,reference].map(async buffer=>gradients(await filtered(buffer,.9),box.width)))
  results.crops[name]={before:averageAbsolute(stages[0],stages[2]),after:averageAbsolute(stages[1],stages[2]),
    gradientBefore:averageAbsolute(edges[0],edges[2]),gradientAfter:averageAbsolute(edges[1],edges[2])}
}

results.directSeamPixels={}
for(const stage of ['before-direct','after-direct']){
  const {data,info}=await sharp(file(`detail-${stage}.png`)).removeAlpha().raw().toBuffer({resolveWithObject:true})
  let count=0
  for(let x=25;x<1500;x++){
    const seam=x<724?13+.208*x:163-.107*(x-724)
    for(let y=Math.floor(seam)-8;y<=seam+8;y++)if(data[(y*info.width+x)*3]>4)count++
  }
  results.directSeamPixels[stage]=count
}

const flat=detailCrops['flat-ceiling']
const reference=await readFile(file('detail-reference-flat-ceiling.png'))
const detail=JSON.parse(await readFile(file('detail-after.json'),'utf8')).views['detail-after-final']
const projection=new Matrix4().fromArray(detail.projection).multiply(new Matrix4().fromArray(detail.camera).invert())
const ceilingPoints=[[1.3,2.38,1.5],[1.3,2.38,1.6]]
const ceilingPixels=ceilingPoints.map(point=>{
  const ndc=new Vector3().fromArray(point).applyMatrix4(projection)
  return [Math.floor((ndc.x*.5+.5)*detail.width),Math.floor((.5-ndc.y*.5)*detail.height)]
})
results.apertureContour={points:ceilingPoints,pixels:ceilingPixels}
for(const name of ['sampling-regular','after-final']){
  const data=await sharp(file(`detail-${name}.png`)).blur(1.5).removeAlpha().raw().toBuffer()
  results.apertureContour[name]=ceilingPixels.map(([x,y])=>luminance(data,(y*detail.width+x)*3))
}
results.sampling={}
for(const name of ['regular','per-pixel','per-tile','exterior-ground','later-bounce']){
  const buffer=await crop(`detail-sampling-${name}`,flat)
  results.sampling[name]={broadVariation:rms(await spatial(buffer,3,16)),
    ceilingMAE:name==='exterior-ground'||name==='later-bounce'?null:averageAbsolute(await filtered(buffer,2),await filtered(reference,2))}
}
for(const name of ['before','after']){
  const phases=['cached-sky','raw-nearest','raw-reconstruction','reconstruction','final']
  results[name]={}
  for(const stage of phases){
    const buffer=await crop(`detail-${name}-${stage}`,flat)
    results[name][stage]={broadVariation:rms(await spatial(buffer,3,16))}
  }
}
const floor=detailCrops['timber-floor'],finish=await spatial(await crop('detail-before-albedo',floor),0,2)
for(const name of ['before-final','after-final','before-direct-no-shadows','after-floor-material']){
  const grain=await spatial(await crop(`detail-${name}`,floor),0,2)
  results.crops['timber-floor'][name]={grainRms:rms(grain),correlation:mean(grain.map((value,i)=>value*finish[i]))/(rms(grain)*rms(finish))}
}

for(const tag of ['detail-matrix','editor-detail-matrix-after']){
  const matrix=JSON.parse(await readFile(file(tag+'.json'),'utf8'))
  results.settings[tag]={}
  for(const row of matrix.matrix){
    const key=`${row.experiment}-${row.divisor}`,name=`${tag}-${key}`
    const settled=await crop(name+'-settled',flat),returned=await crop(name+'-returned',flat)
    results.settings[tag][key]={broadCeilingVariation:rms(await spatial(settled,3,16)),
      ceilingMAE:averageAbsolute(await filtered(settled,2),await filtered(reference,2)),
      returnMAE:averageAbsolute(luma(await rgb(settled)),luma(await rgb(returned)))}
  }
}
await writeFile(file('detail-image-metrics.json'),JSON.stringify(results,null,2))
