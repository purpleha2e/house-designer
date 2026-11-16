import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
const output='tmp/red-house-load';mkdirSync(output,{recursive:true})
const failures=[],warnings=[]
const browser=await lightingBrowser({onEvent:e=>{
  if(e.method==='Network.responseReceived'&&e.params.response.status>=400)failures.push({url:e.params.response.url,status:e.params.response.status})
  if(e.method==='Runtime.consoleAPICalled'&&['warning','warn'].includes(e.params.type))warnings.push(e.params.args.map(a=>a.value??a.description).join(' '))
}}),report={}
try{
  await browser.call('Network.enable')
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=window.fetch;window.fetch=(u,o)=>String(u).includes('/colin_house_v2.json')?f('/red_house_5.json',o):f(u,o);window.confirm=()=>true;`})
  await browser.call('Page.navigate',{url:'http://127.0.0.1:5187/'})
  await browser.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  console.log('Red House editor opened')
  await browser.evaluate(`(async()=>{window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState;window.snapshot=()=>{const s=editorState();return {startup:s?.scene.userData.progressiveStartup,warmup:s?.scene.userData.shaderWarmupPending,failure:s?.scene.userData.shaderWarmupFailure,gi:s?.scene.userData.indirectLighting,atlas:s?.scene.userData.localShadowAtlas,info:s?.gl.info.render,memory:s?.gl.info.memory}}})()`)
  await browser.wait(`!!editorState()?.scene && editorState().scene.userData.progressiveStartup?.phase==='full' && !editorState().scene.userData.shaderWarmupPending && !document.querySelector('.viewport-preparing-overlay')`,180000)
  report.ready=await browser.evaluate('snapshot()');console.log('Red House scene ready',JSON.stringify(report.ready))
  writeFileSync(`${output}/loaded.png`,Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows')?.querySelector('input');if(e&&!e.checked)e.click()})()`)
  await browser.wait(`!editorState().scene.userData.shaderWarmupPending && (editorState().scene.userData.localShadowAtlas?.ready || !editorState().scene.userData.localShadowAtlas)`,120000)
  await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  report.shadows=await browser.evaluate('snapshot()')
  const start=Date.now()
  await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="2D editing floor"]');e.value=[...e.options].find(o=>o.value!==e.value).value;e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.evaluate('new Promise(resolve=>setTimeout(resolve,1500))')
  report.switchMs=Date.now()-start;report.afterSwitch=await browser.evaluate('snapshot()')
  writeFileSync(`${output}/after-switch.png`,Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Red House after floor switch',JSON.stringify(report.afterSwitch))
}catch(error){report.error=String(error);report.diagnostic=await browser.evaluate('window.snapshot?.()').catch(()=>null);console.log('ERROR',String(error))}
finally{Object.assign(report,{errors:browser.errors,failures,warnings});writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({errors:browser.errors,failures,warnings}));browser.close()}
