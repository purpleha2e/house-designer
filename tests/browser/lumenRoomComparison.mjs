import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
const path=name=>fileURLToPath(new URL(name,folder))
const json=async name=>JSON.parse(await readFile(path(name),'utf8'))
const [before,production,after,reference]=await Promise.all(['before.json','production.json','after.json','reference.json'].map(json))
const energy=process.argv.includes('--energy')
const phase3=process.argv.includes('--phase3')
const archived=process.argv.includes('--archived-reference')
const views=energy||phase3?[]:['room','window','doors','doorway']
const modes=phase3?['energy-after','phase3-after','energy-reference']:energy?['energy-before','energy-after',archived?'reference':'energy-reference']:['off','production','before','after','reference']
const labels=phase3?['Phase 2 GI','Phase 3 GI','Independent path trace']:energy?['Previous GI','Surface-cache bounces',`Path trace, ${archived?96:192} samples`]:['GI disabled','Production GI','Original Lumen','Revised Lumen','Path trace, 96 samples']
const inputs=(v)=>[v.camera,v.projection,v.exposure,v.width??v.clip.width,v.height??v.clip.height,(v.tone??v.toneMapping).replace(' composer',''),v.lights??v.inputs??v.sun]
const match=(a,b)=>{
  for(const capture of [a,b])if(capture.fill!==undefined)assert.equal(capture.fill,0,'Indoor fill in daylight comparison')
  assert.deepEqual(JSON.parse(JSON.stringify(inputs(a),(_,v)=>typeof v==='number'?+v.toFixed(7):v)),JSON.parse(JSON.stringify(inputs(b),(_,v)=>typeof v==='number'?+v.toFixed(7):v)))
}
const sheets=[]
if(phase3){
  const [earlier,current,roomReference]=await Promise.all(modes.map(m=>json(m+'.json')))
  match(earlier.views['room-energy-after'],current.views['room-phase3-after'])
  match(earlier.views['room-energy-after'],roomReference.views.room)
  sheets.push({view:'room',files:modes.map(m=>'room-'+m+'.png')})
  for(const view of ['window','doors','doorway']){
    match(after.views[view+'-after'],current.views[view+'-phase3-after']);match(after.views[view+'-after'],reference.views[view])
    sheets.push({view,files:[view+'-after.png',view+'-phase3-after.png',view+'-reference.png']})
  }
  const [landingBaseline,landingNew,landingTruth]=await Promise.all(['energy-after-landing','phase3-after-landing','../reference'].map(p=>json(p+'.json')))
  match(landingBaseline.views['landing-energy-after'],landingNew.views['landing-phase3-after']);match(landingNew.views['landing-phase3-after'],landingTruth.reference)
  sheets.push({view:'landing',files:['landing-energy-after.png','landing-phase3-after.png','../landing-reference.png']})
  if(process.argv.includes('--house-views')){
    const [house,truth]=await Promise.all(['phase3-after-house-views','phase3-reference-house-views'].map(p=>json(p+'.json')))
    for(const view of ['stairwell','sunlitFloor']){
      match(house.views[view+'-phase3-after'],truth.views[view])
      sheets.push({view,house:true,labels:['Phase 3 GI','Independent path trace'],files:[view+'-phase3-after.png',view+'-phase3-reference.png']})
    }
  }
}
if(energy){
  const [original,revised,traced]=await Promise.all(modes.map(m=>json(m+'.json')))
  if(!archived){
    assert.ok(traced.referenceFloorAlbedo?.[0]>2*traced.referenceFloorAlbedo?.[2],'Reference was started before the timber finish loaded')
    assert.ok(traced.views.room?.floorFinish?.map?.width,'The room floor has no texture in the path-traced scene')
  }
  match(original.views['room-energy-before'],revised.views['room-energy-after'])
  match(original.views['room-energy-before'],traced.views.room)
  sheets.push({view:'room',files:modes.map(m=>'room-'+m+'.png')})
}
for(const view of views){
  const base=before.views[view+'-off']
  for(const v of [before.views[view+'-before'],production.views[view+'-production'],after.views[view+'-after'],reference.views[view]])match(base,v)
  sheets.push({view,files:modes.map(m=>view+'-'+m+'.png')})
}
if(process.argv.includes('--landing')){
  const newer=(await json('after-landing.json')).views['landing-after']
  const archived=await json('../lumen.json'),prod=await json('../production.json'),ref=await json('../reference.json')
  for(const v of [archived.captures['landing-off'],archived.captures['landing-lumen'],prod.captures['landing-production'],ref.reference])match(newer,v)
  sheets.push({view:'landing',files:['../landing-off.png','../landing-production.png','../landing-lumen.png','landing-after.png','../landing-reference.png']})
}
const title=(t,width,height)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="8" y="21" font-family="Arial" font-size="15" fill="white">${t}</text></svg>`)
for(const {view,files,house,labels:sheetLabels=labels} of sheets){
  const w=420,h=Math.round(w*(view==='landing'||house?900/1279:934/1585)),tiles=[]
  for(let i=0;i<files.length;i++){
    tiles.push({input:title(sheetLabels[i],w,30),top:0,left:i*w},{input:await sharp(path(files[i])).resize(w,h).png().toBuffer(),top:30,left:i*w})
  }
  await sharp({create:{width:w*files.length,height:h+30,channels:3,background:'#20242a'}}).composite(tiles).png().toFile(path(view+(phase3?'-phase3':energy?'-energy':'')+'-comparison.png'))
}
const report={}
// Average 8 x 8 display pixels first so sub-pixel reference noise and texture
// grain do not dominate the large architectural gradients being compared.
for(const mode of modes){
  const {data,info}=await sharp(path('room-'+mode+'.png')).resize(198,117,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true})
  const y=(x,k)=>{const j=(k*info.width+x)*3;return data[j]*.2126+data[j+1]*.7152+data[j+2]*.0722}
  const metrics={}
  for(const [key,[x0,y0,x1,y1]] of Object.entries({ceiling:[55,2,128,12],wall:[62,33,83,78],floor:[85,98,131,112]})){
    let sum=0,edge=0,n=0
    for(let k=y0;k<y1;k++)for(let x=x0;x<x1;x++){const v=y(x,k);sum+=v;edge+=Math.abs(v-(y(x-1,k)+y(x+1,k)+y(x,k-1)+y(x,k+1))/4);n++}
    metrics[key]={mean:sum/n,localDeviation:edge/n}
  }
  const frame=[]
  // Centre line of the 42 px wide dark stile in the GI-disabled capture.
  // Stay above its reflected ground horizon and away from both pane edges.
  for(let k=29;k<74;k++){const x=Math.round((1346.5-(k*8-230)*.034)/8-.5);frame.push(y(x,k))}
  frame.sort((a,b)=>a-b);const p10=frame[Math.floor(frame.length*.1)],p90=frame[Math.floor(frame.length*.9)]
  metrics.doorStile={p10,p90,spread:p90-p10}
  if(energy){
    let ground=0,count=0
    for(let k=84;k<91;k++)for(let x=176;x<188;x++){ground+=y(x,k);count++}
    metrics.exteriorGroundThroughGlazing={mean:ground/count}
  }
  report[mode]=metrics
}
if(phase3){
  report.fullFrames={}
  for(const {view,files} of sheets){
    const width=160
    const frames=await Promise.all(files.slice(-2).map(async file=>{
      const {data,info}=await sharp(path(file)).resize(width).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true})
      return {data,height:info.height}
    }))
    const [current,reference]=frames
    assert.equal(current.height,reference.height)
    const luma=(frame,index)=>frame.data[index]*.2126+frame.data[index+1]*.7152+frame.data[index+2]*.0722
    let brightnessError=0,absoluteBrightnessError=0,chromaError=0,gradientError=0,edges=0
    const pixels=width*current.height
    for(let pixel=0;pixel<pixels;pixel++){
      const i=pixel*3,y=luma(current,i),r=luma(reference,i)
      brightnessError+=y-r
      absoluteBrightnessError+=Math.abs(y-r)
      for(let channel=0;channel<3;channel++)chromaError+=Math.abs((current.data[i+channel]-y)-(reference.data[i+channel]-r))
      if(pixel%width>0){gradientError+=Math.abs((y-luma(current,i-3))-(r-luma(reference,i-3)));edges++}
      if(pixel>=width){gradientError+=Math.abs((y-luma(current,i-width*3))-(r-luma(reference,i-width*3)));edges++}
    }
    report.fullFrames[view]={width,height:current.height,meanLumaBias:brightnessError/pixels,meanAbsoluteLumaError:absoluteBrightnessError/pixels,
      meanAbsoluteChromaError:chromaError/(pixels*3),meanAbsoluteGradientError:gradientError/edges}
  }
}
await writeFile(path(phase3?'phase3-image-measurements.json':energy?'energy-image-measurements.json':'image-measurements.json'),JSON.stringify(report,null,2))
