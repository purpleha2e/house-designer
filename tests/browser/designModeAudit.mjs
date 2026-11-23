import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {PerspectiveCamera} from 'three'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
import {roomViews} from './lumenRoomViews.mjs'
import {springfieldRoute} from './lumenSpringfieldRoute.mjs'

const fixture=process.argv[2]??'room',spring=fixture==='springfield'
assert.ok(['room','springfield','enclosed','furnished'].includes(fixture))
const origin=process.env.LUMEN_ORIGIN??'http://127.0.0.1:5188'
const folder=new URL('../../docs/design-mode/',import.meta.url)
await mkdir(folder,{recursive:true})
const project=spring?'springfield_14':fixture==='furnished'?'colin_house_v2':'lighting-test'
const furnished=new PerspectiveCamera(62)
furnished.position.set(3.9,4.25,8.1);furnished.lookAt(1.88,3.78,6.65)
const pose=spring?roomViews.landing:fixture==='furnished'?{
  position:furnished.position.toArray(),quaternion:furnished.quaternion.toArray(),fov:furnished.fov,
}:roomViews.room
const report={fixture,project,walk:[],checks:[]},b=await lightingBrowser()
const save=()=>writeFile(new URL(fixture+'.json',folder),JSON.stringify(report,null,2))
const evaluate=(fn,...args)=>b.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
const native=()=>b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
const ready="perfScene()?.scene.userData.progressiveStartup?.phase==='full'&&!perfScene().scene.userData.shaderWarmupPending"
const mode=name=>`perfScene()?.scene.userData.viewportLightingWork?.mode===${JSON.stringify(name)}`
async function menu(){
  await b.evaluate("if(!document.querySelector('[aria-label=\"Lighting mode\"]'))document.querySelector('[aria-label=\"3D view menu\"]').click()")
  await b.wait("!!document.querySelector('[aria-label=\"Lighting mode\"]')")
}
async function setChoice(label,value){
  await evaluate((label,value)=>{
    const element=document.querySelector('[aria-label="'+label+'"]')
    if(!element)throw Error('Missing '+label)
    element.value=value
    element.dispatchEvent(new Event('change',{bubbles:true}))
  },label,value)
}
const closeMenu=()=>b.evaluate("if(document.querySelector('[aria-label=\"Lighting mode\"]'))document.querySelector('[aria-label=\"3D view menu\"]').click()")
async function setPose(view=pose){
  await evaluate(p=>{
    const s=perfScene()
    s.camera.position.fromArray(p.position)
    s.camera.quaternion.fromArray(p.quaternion)
    s.camera.fov=p.fov
    s.camera.updateProjectionMatrix()
    s.camera.updateMatrixWorld(true)
    s.invalidate()
  },view)
}
async function loadProject(){
  await evaluate(async({project,fixture,pose})=>{
    window.projectFileFixture=async()=>{
      const source=await(await fetch('/'+project+'.json')).json()
      window.designSavedGI={present:!!source.indirectLighting,settings:source.indirectLighting?.settings}
      const view=source.threeDView??={}
      view.camera={position:{x:pose.position[0],y:pose.position[1],z:pose.position[2]},
        quaternion:{x:pose.quaternion[0],y:pose.quaternion[1],z:pose.quaternion[2],w:pose.quaternion[3]}}
      if(fixture==='enclosed'){
        for(const floor of source.floors){
          const removed=new Set(floor.walls.flatMap(w=>w.openings??[]).map(o=>o.modelId).filter(Boolean))
          floor.walls=floor.walls.map(w=>({...w,openings:[]}))
          floor.models=floor.models.filter(m=>!removed.has(m.id)&&!m.modelId.includes('window')&&!m.wallAttachment&&!m.modelId.includes('9f64ec3f'))
        }
      }
      return [{getFile:async()=>new File([JSON.stringify(source)],project+'.json')}]
    }
    const {watchEditorLoad}=await import('/tests/browser/lumenLifecycle.js')
    window.designLoadClock=performance.now()
    window.stopDesignStartup=watchEditorLoad(pose)
  },{project,fixture,pose})
  await b.evaluate("document.querySelector('[aria-label=\"Project menu\"]').click()")
  await b.wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Load')")
  await b.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Load').click()")
  await b.wait(`(()=>{const discard=[...document.querySelectorAll('dialog button')].find(e=>/discard changes and open/i.test(e.textContent));discard?.click();return Math.abs((perfScene()?.camera?.position.z??Infinity)-${pose.position[2]})<.2})()`,180000)
  console.log(fixture,'project loaded')
}
async function fullViewport(){
  const expectedWidth=spring?1278:1584
  const full=`perfScene().gl.domElement.getBoundingClientRect().width>=${expectedWidth} && perfScene().gl.domElement.width>=${expectedWidth}`
  if(!await b.evaluate(full)){
    await b.call('Runtime.evaluate',{expression:"document.querySelector('[aria-label=\"Enter fullscreen\"]')?.click()",userGesture:true})
  }
  await b.wait(full,30000)
}
async function capture(label,view=pose){
  await setPose(view)
  await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const clip=await b.evaluate("(()=>{const r=perfScene().gl.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()")
  await b.evaluate("document.documentElement.classList.add('design-capture')")
  try{
    const {data}=await b.call('Page.captureScreenshot',{format:'png',clip})
    await writeFile(new URL(fixture+'-'+label+'.png',folder),Buffer.from(data,'base64'))
  }finally{await b.evaluate("document.documentElement.classList.remove('design-capture')")}
}
async function resources(){
  return b.evaluate(`(()=>{
    const s=perfScene(),u=s.scene.userData,snap=audit.snapshot(),native=s.gl.getContext().__rendererAudit
    const cube=[...native.textures.values()].filter(t=>t.target===34067&&Object.values(t.levels??{}).some(l=>l.width>1))
    const volumes=[...native.textures.values()].filter(t=>Object.values(t.levels??{}).some(l=>l.depth>1))
    const workers=snap.workers.filter(w=>/indirect|lumen|sixRay|lightOcclusion/i.test(w.url)||w.kinds['lighting-keys'])
    const materialFamilies=new Map(),glazing=new Map(),unexpectedMaterials=[]
    s.scene.traverse(o=>{
      if(!o.material)return
      const role=o.userData.houseDesignerRole
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(u.viewportLightingWork?.mode==='design'&&/house-designer-room-light|house-designer-indirect-grid/.test(m.customProgramCacheKey())){
          unexpectedMaterials.push({role,name:m.name,key:m.customProgramCacheKey().slice(-250)})
        }
        if(/glass|glazing|clear.pane/i.test(m.name)){
          glazing.set(m.name,{name:m.name,transparent:m.transparent,opacity:m.opacity,transmission:m.transmission})
        }
        if(role!=='room-floor-finish'&&role!=='wall-engine-render')continue
        const dims=t=>t?.image?.width?[t.image.width,t.image.height]:null
        const row={role,name:m.name,map:dims(m.map),normal:dims(m.normalMap),roughness:dims(m.roughnessMap),metalness:dims(m.metalnessMap),anisotropy:m.map?.anisotropy}
        if(row.map)materialFamilies.set(JSON.stringify(row),row)
      }
    })
    return {lighting:u.viewportLightingWork,shader:u.viewportShaderAudit.totals,startup:u.progressiveStartup,
      workers,liveTargets:snap.targets.filter(t=>!t.disposed),
      cubeTextures:cube.filter(t=>native.live.textures.has(t.id)).length,volumeTextures:volumes.filter(t=>native.live.textures.has(t.id)).length,
      liveVolumeDimensions:volumes.filter(t=>native.live.textures.has(t.id)).flatMap(t=>Object.values(t.levels).map(l=>[l.width,l.height,l.depth])),
      allocatedCubeTextures:cube.length,allocatedVolumeTextures:volumes.length,
      textures:snap.three.textures,dimensions:snap.canvas,hardware:snap.hardware,errors:snap.errors,
      materials:[...materialFamilies.values()],glazing:[...glazing.values()],unexpectedMaterials,
      actual:{probe:!!u.getLightingField,lumen:!!u.lumenGI,sixRay:!!u.sixRayGI,modelling:!!u.modellingLighting,
        roomLight:!!u.prepareRoomLightMaterials,reflections:!!u.indirectReflectionPending}}
  })()`)
}
function assertDesign(state,{afterPreview=false}={}){
  assert.equal(state.lighting.mode,'design')
  assert.ok(Object.values(state.lighting.design).every(v=>v===0),JSON.stringify(state.lighting))
  assert.ok(Object.values(state.actual).every(v=>v===false),JSON.stringify(state.actual))
  assert.ok(state.workers.every(w=>afterPreview?w.terminated||!(/indirect|lumen|sixRay/i.test(w.url)):false),JSON.stringify(state.workers))
  assert.equal(state.cubeTextures,0)
  assert.equal(state.volumeTextures,0)
  if(!afterPreview){assert.equal(state.allocatedCubeTextures,0);assert.equal(state.allocatedVolumeTextures,0)}
  assert.deepEqual(state.errors,[])
  assert.deepEqual(state.unexpectedMaterials,[])
}
async function measure(label,points=null,duration=3200){
  const collect=profile=>evaluate(async({points,profile,duration})=>{
    const {camera}=perfScene()
    let move=true
    if(points){
      const a=camera.position.clone(),z=camera.position.clone(),original=camera.quaternion.clone()
      const lengths=points.slice(1).map((p,i)=>Math.hypot(...p.map((x,j)=>x-points[i][j])))
      const distance=lengths.reduce((x,v)=>x+v,0)
      const at=(distance,out)=>{
        let segment=0
        while(segment<lengths.length-1&&distance>lengths[segment])distance-=lengths[segment++]
        const p=points[segment],n=points[segment+1],f=Math.min(1,distance/lengths[segment])
        out.set(...p.map((v,i)=>v+(n[i]-v)*f))
      }
      move=(camera,f)=>{
        at(f*distance,a);at(Math.min(distance,f*distance+.42),z)
        camera.position.copy(a)
        if(a.distanceToSquared(z)>.0001){z.y-=.12;camera.lookAt(z)}else camera.quaternion.copy(original)
        camera.updateMatrixWorld(true)
      }
    }
    const row=await audit.sample(duration,move,profile)
    return {fps:row.presentedFPS,frames:row.frames,interval:row.frameMs,cpu:row.cpuFrameMs,gpu:row.gpuFrameMs,newPrograms:row.newPrograms,
      passes:profile?row.passes.map(x=>({name:x.name,gpu:x.gpuMs,cpu:x.cpuMsPerFrame,draws:x.drawCallsPerFrame,triangles:x.trianglesPerFrame})):undefined}
  },{points,profile,duration})
  const row={label,wholeFrame:await collect(false),passes:await collect(true)}
  report.walk.push(row)
  await save()
  console.log(fixture,label,row.wholeFrame.fps.toFixed(1),row.wholeFrame.interval.p95.toFixed(1))
}

try{
  await b.call('Log.enable')
  await b.call('Emulation.setDeviceMetricsOverride',{width:spring?1279:1585,height:spring?900:934,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:'('+installNativeAudit.toString()+')();'+projectFileInputFixtureSource+';window.confirm=()=>false;window.alert=m=>console.error(m);'})
  if(process.argv.includes('--old-preference'))await b.call('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('house-designer-viewport-lighting-model-v1','modelling')"})
  await b.call('Page.navigate',{url:origin+'/tests/browser/editorRegression.html'})
  await b.wait(`!!window.perfScene?.()&&!!document.querySelector('[aria-label="Project menu"]')&&${mode('design')}`,180000)
  await menu()
  report.ui=await b.evaluate("(()=>{const e=document.querySelector('[aria-label=\"Lighting mode\"]');return {value:e.value,choices:[...e.options].map(o=>o.textContent),giBackend:!!document.querySelector('[aria-label=\"GI backend\"]')}})()")
  assert.deepEqual(report.ui,{value:'design',choices:['Design','Realistic Preview'],giBackend:false})
  await closeMenu()
  await b.call('Runtime.evaluate',{expression:"document.querySelector('[aria-label=\"Enter fullscreen\"]')?.click()",userGesture:true})
  await loadProject()
  await b.wait(ready,300000)
  await fullViewport()
  if(spring){
    const control=await b.evaluate("document.querySelector('[aria-label=\"3D visible floors\"]')?.value")
    if(control&&control!=='all')await setChoice('3D visible floors','all')
    report.floorView=await b.evaluate("document.querySelector('[aria-label=\"3D visible floors\"]')?.value")
    assert.equal(report.floorView,'all')
    await b.wait(ready,300000)
  }
  report.startup=await b.evaluate('stopDesignStartup()')
  report.authoredCache=await b.evaluate('window.designSavedGI')
  await setPose()
  await evaluate(async()=>{
    const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(perfScene())
    const style=document.createElement('style')
    style.textContent='.design-capture body *{visibility:hidden!important}.design-capture body canvas{visibility:visible!important}'
    document.head.append(style)
  })
  report.initial=await resources();assertDesign(report.initial);await save()
  await capture('ao')
  await measure('Matched view')
  await b.evaluate('audit.configure({ao:false})')
  try{
    await capture('no-ao')
    await measure('AO bypass')
  }finally{await b.evaluate('audit.configure({ao:true})')}
  if(spring&&!process.argv.includes('--short')){
    for(const segment of springfieldRoute)await measure(segment.name,segment.points,3800)
    const camera=new PerspectiveCamera(62)
    camera.position.set(11.09,4.08,7.73)
    camera.lookAt(11.09,1.85,10.5)
    await capture('stairs',{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:62})
  }
  report.afterMotion=await resources()
  assertDesign(report.afterMotion)
  assert.deepEqual(await native(),report.initial.shader,'Movement or AO toggle compiled viewport shaders')
  if(process.argv.includes('--edits')){
    const {auditDesignEdits}=await import('./designModeEdits.mjs')
    await auditDesignEdits(b,{fixture,report,save,ready,native,mode,resources,assertDesign,menu,closeMenu,setChoice,setPose,capture})
  }
  await save()
  assert.deepEqual(b.errors,[])
}catch(e){
  report.failure=String(e)
  report.errors=b.errors
  report.browserLog=b.logs.filter(entry=>entry.level==='warning'||entry.level==='error').slice(-50)
  report.diagnostics=await b.evaluate("(()=>{const u=perfScene()?.scene.userData;return {lighting:u?.viewportLightingWork,startup:u?.progressiveStartup,origins:u?.viewportShaderAudit?.programOrigins,events:u?.viewportShaderAudit?.events,warmup:u?.shaderWarmupProfile?.slice(-4),status:document.body.innerText.slice(-2300)}})()").catch(()=>null)
  await save()
  throw e
}finally{b.close()}
