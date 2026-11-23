import assert from 'node:assert/strict'
import {access,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {wallVariation} from './lumenMatchedViews.mjs'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const path=name=>fileURLToPath(new URL(name,folder))
const parse=async name=>JSON.parse(await readFile(path(name),'utf8'))
const reference=(await parse('energy-reference.json')).views.room
const old=await parse('pipeline-before.json'),current=await parse('pipeline-after.json')
const same=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?+v.toFixed(7):v))
const names=['Direct only','GI only, normal exposure','GI only, +4 EV','Combined scene-linear','Final lighting','Independent path trace']
const report={}
const matrix=(columns,colour)=>colour.map((_,row)=>columns.reduce((sum,column,c)=>sum+column[row]*colour[c],0))
const display=(sceneLinear,exposure)=>{
  const working=matrix([[.59719,.076,.0284],[.35458,.90834,.13383],[.04823,.01566,.83777]],sceneLinear.map(v=>v*exposure/.6))
  const fit=working.map(x=>(x*(x+.0245786)-.000090537)/(x*(.983729*x+.432951)+.238081))
  return matrix([[1.60475,-.10208,-.00327],[-.53108,1.10813,-.07276],[-.07367,-.00605,1.07602]],fit).map(v=>{
    const x=Math.max(0,Math.min(1,v))
    return Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055))
  })
}
for(const item of [old,current]){
  const tag='room-'+item.mode,meta=item.views[tag+'-final']
  for(const layer of Object.values(item.views)){
    assert.deepEqual(same([layer.camera,layer.projection,layer.exposure,layer.lights,layer.width,layer.height]),
      same([reference.camera,reference.projection,reference.exposure,reference.inputs,reference.width,reference.height]))
    assert.equal(layer.tone,reference.toneMapping);assert.equal(layer.fill,0)
  }
  const width=420,height=Math.round(width*meta.height/meta.width),tiles=[]
  const files=['direct','gi-one','gi-16','linear','final'].map(layer=>tag+'-'+layer+'.png').concat('room-energy-reference.png')
  for(const [i,file] of files.entries()){
    const left=i%3*width,top=Math.floor(i/3)*(height+30)
    const label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30"><text x="8" y="21" font-family="Arial" font-size="15" fill="white">${names[i]}</text></svg>`)
    tiles.push({input:label,top,left},{input:await sharp(path(file)).resize(width,height).png().toBuffer(),top:top+30,left})
  }
  await sharp({create:{width:width*3,height:(height+30)*2,channels:3,background:'#20242a'}}).composite(tiles).png().toFile(path(tag+'-layers.png'))
  const [a,b]=await Promise.all([tag+'-final.png','room-energy-reference.png'].map(file=>sharp(path(file)).resize(160).removeAlpha().raw().toBuffer()))
  let sum=0
  for(let i=0;i<a.length;i+=3)sum+=Math.abs((a[i]-b[i])*.2126+(a[i+1]-b[i+1])*.7152+(a[i+2]-b[i+2])*.0722)
  report[item.mode]={displayLumaMAE:3*sum/a.length}
}
report.exposureExamples=Object.fromEntries(Object.entries(current.layers.final).map(([name,linear])=>{
  const r=current.reference[name],expected=r.directSky.map((value,c)=>value+r.indirect[c]+r.solar[c])
  assert.ok(display(linear,1).every((v,c)=>Math.abs(v-current.displayed[name][c])<=1),'Normal exposure prediction differs from the actual display')
  return [name,{actual0EV:current.displayed[name],predicted1EV:display(linear,2),diffuseReference0EV:display(expected,1),diffuseReference1EV:display(expected,2)}]
}))
if(await access(path('room-pipeline-resolved-indirect.png')).then(()=>true,()=>false)){
  report.wallVariation=Object.fromEntries(await Promise.all(['cached-sky','raw-indirect','resolved-indirect'].map(async name=>
    [name,await wallVariation(path('room-pipeline-'+name+'.png'))])))
  const [patches,distance]=await Promise.all(['patch','distance'].map(name=>readFile(path('room-pipeline-'+name+'-hits.png'))))
  report.identicalTraceHits=patches.equals(distance)
}
await writeFile(path('pipeline-image-summary.json'),JSON.stringify(report,null,2))
