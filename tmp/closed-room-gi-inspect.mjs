import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
const output='tmp/closed-room-gi';mkdirSync(output,{recursive:true})
const source=readFileSync('C:/Users/robma/Downloads/house-design.house.json')
writeFileSync(`${output}/model.json`,source)
const warnings=[],failures=[],report={}
const b=await lightingBrowser({onEvent:async e=>{
  if(e.method==='Runtime.consoleAPICalled'&&['warning','warn'].includes(e.params.type))warnings.push(e.params.args.map(a=>a.value??a.description).join(' '))
  if(e.method==='Network.responseReceived'&&e.params.response.status>=400)failures.push({url:e.params.response.url,status:e.params.response.status})
}})
try {
  await b.call('Network.enable')
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(u,o)=>f(String(u).includes('/colin_house_v2.json')?'/tmp/closed-room-gi/model.json':u,o)`})
  await b.call('Page.navigate',{url:'http://127.0.0.1:5187/'})
  await b.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  await b.evaluate(`(async()=>{window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState;window.snapshot=()=>{const s=editorState();return {startup:s?.scene.userData.progressiveStartup,preparation:s?.scene.userData.viewportPreparation,warmup:s?.scene.userData.shaderWarmupPending,gi:s?.scene.userData.indirectLighting,soft:s?.scene.userData.softFloorGI}}})()`)
  await b.wait(`['ready','fallback'].includes(editorState()?.scene.userData.indirectLighting?.state)`,120000)
  report.result=await b.evaluate('snapshot()')
  console.log(JSON.stringify(report.result))
  writeFileSync(`${output}/result.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
}catch(error){report.error=String(error);report.diagnostic=await b.evaluate('window.snapshot?.()').catch(()=>null);console.log('FAILED',JSON.stringify(report))}
finally{Object.assign(report,{warnings,failures,errors:b.errors});writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({warnings,failures,errors:b.errors}));b.close()}
