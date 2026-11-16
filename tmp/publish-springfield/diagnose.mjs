import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { installSceneEditPreload } from '../../tests/browser/sceneEditTrace.js'
import { writeFileSync } from 'node:fs'
const browser=await lightingBrowser({onEvent(m){if(m.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(m.params.type))console.log(m.params.type,m.params.args.map(a=>a.value??a.description).join(' ').slice(0,1800))}})
try {
 await browser.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true})
 await browser.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
 await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installSceneEditPreload.toString()})()`})
 await browser.call('Page.navigate',{url:process.argv[2]??'http://127.0.0.1:5183/'})
 for(let i=0;i<32;i++){
  await new Promise(r=>setTimeout(r,10000))
  const result=await browser.evaluate(`(()=>{let props,scene;const walk=f=>{if(!f)return;const p=f.memoizedProps;if(p?.requireSavedCache&&p.cacheProjectKey)props={project:p.cacheProjectKey,assets:p.cacheAssetKey,settings:p.cacheSettings,saved:{project:p.savedCache?.projectKey,assets:p.savedCache?.assetKey,settings:p.savedCache?.settings}};scene??=f.stateNode?.__r3f?.root?.getState()?.scene;scene??=p?.value?.getState?.()?.scene;for(let d=f.dependencies?.firstContext;d;d=d.next)scene??=d.memoizedValue?.getState?.()?.scene;walk(f.child);walk(f.sibling)};for(const root of sceneEditTrace.roots.keys())walk(root.current);window.auditScene=scene;const u=scene?.userData;return {props,gi:u?.indirectLighting,exterior:u?.exteriorSkyOcclusion,warm:u?.shaderWarmupPending,scan:u?.indirectScanPending,strength:u?.getIndirectUniforms?.().hdExteriorSkyStrength.value,feature:u?.getIndirectUniforms?.().hdExteriorSkyFeature.value,text:document.body.innerText.slice(-1000)}})()`)
  writeFileSync('tmp/publish-springfield/runtime-diagnostic.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
  if(result.gi?.state==='ready'&&result.exterior?.state==='ready'&&result.strength>0&&!result.warm)break
 }
 const shot=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/publish-springfield/runtime.png',Buffer.from(shot.data,'base64'))
}finally{browser.close()}

