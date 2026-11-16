import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
const output='tmp/closed-room-bands-after';mkdirSync(output,{recursive:true})
const source=readFileSync('C:/Users/robma/Downloads/house-design.house.json')
writeFileSync(`${output}/model.json`,source)
const warnings=[],failures=[],report={}
const b=await lightingBrowser({onEvent:async e=>{
  if(e.method==='Runtime.consoleAPICalled'&&['warning','warn'].includes(e.params.type))warnings.push(e.params.args.map(a=>a.value??a.description).join(' '))
  if(e.method==='Network.responseReceived'&&e.params.response.status>=400)failures.push({url:e.params.response.url,status:e.params.response.status})
}})
try {
  await b.call('Network.enable')
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(u,o)=>f(String(u).includes('/colin_house_v2.json')?'/tmp/closed-room-bands-after/model.json':u,o)`})
  await b.call('Page.navigate',{url:'http://127.0.0.1:5187/'})
  await b.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  await b.evaluate(`(async()=>{window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState;window.snapshot=()=>{const s=editorState();return {startup:s?.scene.userData.progressiveStartup,preparation:s?.scene.userData.viewportPreparation,warmup:s?.scene.userData.shaderWarmupPending,gi:s?.scene.userData.indirectLighting,soft:s?.scene.userData.softFloorGI}}})()`)
  await b.wait(`editorState()?.scene.userData.progressiveStartup?.phase==='full' && editorState()?.scene.userData.exteriorSkyOcclusion?.state==='ready' && !editorState()?.scene.userData.shaderWarmupPending`,120000)
  await b.evaluate(`(()=>{const s=editorState();s.camera.position.set(11,4,-7);s.camera.lookAt(5,1.2,4);s.controls?.target?.set(5,1.2,4);s.controls?.update();s.invalidate()})()`)
  const shot=async name=>{
    await b.evaluate('new Promise(r=>setTimeout(r,1200))')
    const clip=await b.evaluate(`(()=>{const r=editorState().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
    writeFileSync(`${output}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png',clip})).data,'base64'))
  }
  const toggle=async (label,checked)=>{
    await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await b.evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)})?.querySelector('input');if(!e)throw Error('Missing toggle '+${JSON.stringify(label)});if(e.checked!==${checked})e.click()})()`)
    await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await b.wait(`!editorState().scene.userData.shaderWarmupPending && !document.querySelector('.viewport-preparing-overlay')`)
  }
  await shot('baseline')
  await b.evaluate(`(()=>{const s=editorState();s.camera.position.set(5.4,.7,7);s.camera.lookAt(5.4,.4,8.95);s.controls?.target?.set(5.4,.4,8.95);s.controls?.update();s.invalidate()})()`)
  await shot('corner')
  await b.evaluate(`(()=>{const s=editorState();s.camera.position.set(11,4,-7);s.camera.lookAt(5,1.2,4);s.controls?.target?.set(5,1.2,4);s.controls?.update();s.invalidate()})()`)

  await toggle('Exterior sky occlusion (experimental)',false);await shot('no-exterior-occlusion')
  await toggle('Shadows',false);await shot('no-shadows')
  await toggle('Ambient occlusion',false);await shot('no-ao')
  await toggle('Indirect lighting (GI)',false);await shot('no-gi')
  report.result=await b.evaluate('snapshot()')
  console.log(JSON.stringify(report.result))
  writeFileSync(`${output}/result.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
}catch(error){report.error=String(error);report.diagnostic=await b.evaluate('window.snapshot?.()').catch(()=>null);console.log('FAILED',JSON.stringify(report))}
finally{Object.assign(report,{warnings,failures,errors:b.errors});writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({warnings,failures,errors:b.errors}));b.close()}
