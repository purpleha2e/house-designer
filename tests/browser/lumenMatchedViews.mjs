import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {roomViews} from './lumenRoomViews.mjs'

const normalize=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?+v.toFixed(7):v))
const measure=async (images,width=160)=>{
  const frames=await Promise.all(images.map(image=>sharp(image).resize(width).removeAlpha().raw().toBuffer()))
  const luma=(pixels,i)=>pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722
  let biased=0,absolute=0,gradient=0,edges=0
  for(let i=0;i<frames[0].length;i+=3){
    const error=luma(frames[0],i)-luma(frames[1],i)
    biased+=error;absolute+=Math.abs(error)
    for(const delta of [i%(width*3)>0?3:0,i>=width*3?width*3:0])if(delta){
      gradient+=Math.abs(error-luma(frames[0],i-delta)+luma(frames[1],i-delta));edges++
    }
  }
  return {brightnessBias:3*biased/frames[0].length,brightnessMAE:3*absolute/frames[0].length,gradientMAE:gradient/edges}
}

async function sheet(rendered,reference,target,width,height){
  const images=await Promise.all([rendered,reference].map(image=>sharp(image).resize(width,height).removeAlpha().raw().toBuffer()))
  const difference=Buffer.from(images[0].map((value,i)=>Math.min(255,4*Math.abs(value-images[1][i]))))
  images.push(difference)
  const tiles=[]
  for(const [i,name] of ['Final lighting','Independent path trace','Absolute display difference ×4'].entries()){
    const label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30"><text x="8" y="21" font-family="Arial" font-size="15" fill="white">${name}</text></svg>`)
    tiles.push({input:label,top:0,left:i*width},{input:await sharp(images[i],{raw:{width,height,channels:3}}).png().toBuffer(),top:30,left:i*width})
  }
  await sharp({create:{width:width*3,height:height+30,channels:3,background:'#20242a'}}).composite(tiles).png().toFile(target)
}

export async function wallVariation(image){
  const {data,info}=await sharp(image).resize(320).removeAlpha().raw().toBuffer({resolveWithObject:true})
  const value=(x,y)=>{
    const i=(y*info.width+x)*3
    return data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722
  }
  let sum=0,count=0
  for(let y=Math.round(info.height*.34);y<info.height*.63;y++)for(let x=Math.round(info.width*.32);x<info.width*.43;x++){
    sum+=Math.abs(value(x,y)-(value(x-1,y)+value(x+1,y)+value(x,y-1)+value(x,y+1))*.25);count++
  }
  return sum/count
}

export async function runLumenMatchedViews({browser,evaluate,capture,select,report,save,folder,landing,pipelineView}){
  const path=name=>fileURLToPath(new URL(name,folder))
  const base=landing?roomViews.landing:roomViews.room
  const poses=landing?{landing:base}:{room:base,'near-patio':{...roomViews.doors,position:[1.75,1.48,3.10]},
    'away-from-patio':{...base,position:[2.87638,1.44840,8.75908]},
    'opposite-side':{...base,position:[.42,1.50,6.65],lookAt:[1.8,1.37,1.2]},'sun-angle':base}
  const archive=landing?(JSON.parse(await readFile(path('../reference.json'),'utf8'))).reference:
    (JSON.parse(await readFile(path('energy-reference.json'),'utf8'))).views.room
  const ready="roofWallScene().scene.userData.lumenGI?.state==='ready' && roofWallScene().scene.userData.lumenGI.bounceReady && !roofWallScene().scene.userData.lumenGI.refining"
  const native=()=>browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})')
  report.nativeBefore=await native();report.matched={}
  if(pipelineView)assert.ok(poses[pipelineView],`Unknown pipeline reference view ${pipelineView}`)
  for(const [name,pose] of Object.entries(poses)){
    if(pipelineView&&name!==pipelineView)continue
    if(name==='sun-angle'){
      const before=await browser.evaluate('roofWallScene().scene.userData.lumenGI.sunFrames')
      await browser.evaluate('updateRegressionSunPosition(sun=>({...sun,azimuth:sun.azimuth+.35,elevation:sun.elevation-.22}))')
      await browser.wait(`roofWallScene().scene.userData.lumenGI.sunFrames>${before}`)
    }
    await evaluate(async pose=>{
      const s=roofWallScene();s.camera.position.fromArray(pose.position);s.camera.quaternion.fromArray(pose.quaternion);s.camera.fov=pose.fov
      if(pose.lookAt)s.camera.lookAt(...pose.lookAt)
      s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true)
      for(let i=0;i<5;i++){s.scene.userData.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}
    },pose)
    await browser.wait(ready,440000)
    const tag=name+'-pipeline-views';await capture(tag)
    const archived=name==='room'||name==='landing'
    let truth=archive,reference
    if(archived)reference=await readFile(path(landing?'../landing-reference.png':'room-energy-reference.png'))
    else{
      await evaluate(()=>{
        window.pipelineReference=null;window.pipelineReferenceError=null
        setTimeout(()=>import('/tests/browser/springfieldReference.ts').then(m=>m.traceLandingReference(roofWallScene(),96,.36))
          .then(result=>window.pipelineReference=result).catch(error=>window.pipelineReferenceError=String(error)),0)
      })
      await browser.wait('(()=>{if(window.pipelineReferenceError)throw Error(pipelineReferenceError);return !!window.pipelineReference})()',600000)
      const saved=await browser.evaluate('window.pipelineReference');truth=saved.stats;reference=Buffer.from(saved.image.split(',')[1],'base64')
    }
    const rendered=await readFile(path(tag+'.png')),meta=report.views[tag]
    assert.deepEqual(normalize([meta.camera,meta.projection,meta.exposure,meta.width,meta.height,meta.lights]),
      normalize([truth.camera,truth.projection,truth.exposure,truth.width,truth.height,truth.inputs]))
    assert.equal(meta.fill,0);assert.equal(meta.tone,truth.toneMapping)
    const locations=name==='near-patio'?{leftOfDoors:[.17,.54],rightOfDoors:[.84,.52],ceiling:[.46,.085]}:
      {wall:[.39,.53],floor:[.53,.84],ceiling:[.46,.085]}
    const numerics=await evaluate(async locations=>{
      const s=roofWallScene(),inspect=s.scene.userData.inspectLumenPixel,{checkLumenPixels}=await import('/tests/browser/lumenPixelReference.ts')
      const samples={}
      for(const [key,uv] of Object.entries(locations))samples[key]=await inspect(...uv)
      return {samples,reference:await checkLumenPixels(s,samples,true)}
    },locations)
    const comparisons=Object.fromEntries(Object.entries(numerics.reference).filter(([,value])=>value.hit && !value.unmatched).map(([key,value])=>{
      const expected=value.directSky.map((v,c)=>v+value.indirect[c]+value.solar[c])
      return [key,{position:value.hit.position,expected,observed:numerics.samples[key].composedSceneLinear.slice(0,3),samples:value.samples}]
    }))
    await sheet(rendered,reference,path(name+'-pipeline-comparison.png'),420,Math.round(420*meta.height/meta.width))
    report.matched[name]={reference:truth,image:await measure([rendered,reference]),receivers:comparisons}
    if(name==='room'){
      for(const [index,label] of [[16,'cached-sky'],[6,'patch-hits'],[13,'raw-indirect'],[14,'resolved-indirect']]){
        await select('Lumen GI view',index);await capture('room-pipeline-'+label)
      }
      report.wallVariation=Object.fromEntries(await Promise.all(['cached-sky','raw-indirect','resolved-indirect'].map(async name=>
        [name,await wallVariation(path('room-pipeline-'+name+'.png'))])))
      await select('Lumen trace method','sdf')
      await browser.wait(`roofWallScene().scene.userData.lumenGI.trace==='sdf' && ${ready}`,360000)
      await select('Lumen GI view',6);await capture('room-pipeline-distance-hits')
      await select('Lumen trace method','patches');await select('Lumen GI view',0)
    }
    await save();console.log(name,'matched comparison complete')
  }
  report.nativeAfter=await native();await save()
  assert.deepEqual(report.nativeBefore,report.nativeAfter)
  assert.deepEqual(browser.errors,[])
}
