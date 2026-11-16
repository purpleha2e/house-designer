import {lightingBrowser}from'../../tests/browser/lightingHarness.mjs'
import{writeFileSync,readFileSync}from'node:fs'
const browser=await lightingBrowser(),started=Date.now()
try{
 await browser.call('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false})
 await browser.call('Page.navigate',{url:'http://127.0.0.1:5187/tmp/publish-springfield/bake.html'})
 for(;;){
  const result=await browser.evaluate(`(()=>{const s=window.exportState?.(),u=s?.scene.userData;return {cache:!!window.exportCache,phase:u?.progressiveStartup?.phase,warm:u?.shaderWarmupPending,gi:u?.indirectLighting,body:document.body.innerText.slice(-650)}})()`)
  writeFileSync('tmp/publish-springfield/bake-status.json',JSON.stringify({elapsedSeconds:(Date.now()-started)/1000,...result},null,2))
  console.log(JSON.stringify({seconds:Math.round((Date.now()-started)/1000),phase:result.phase,warm:result.warm,state:result.gi?.state,completed:result.gi?.completed,total:result.gi?.total,cache:result.cache}))
  if(browser.errors.length)throw Error(browser.errors.join('\n'))
  if(result.cache)break
  if(Date.now()-started>45*60*1000)throw Error('Lighting export exceeded 45 minutes')
  await new Promise(r=>setTimeout(r,10000))
 }
 const cache=await browser.evaluate('exportCache')
 const source=JSON.parse(readFileSync('springfield_14.json','utf8'))
 const house=await browser.evaluate('exportHouse')
 source.modelDefinitions=house.project.modelDefinitions.map(m=>({...m,...(m.sourceUrl?{sourceUrl:m.sourceUrl.replace('./published-assets/','/')}: {})}))
 source.indirectLighting=cache
 writeFileSync('tmp/publish-springfield/springfield-tour.house.json',JSON.stringify(source))
 await browser.evaluate('verifyExport()')
 await browser.wait(`window.exportState?.()?.scene.userData.indirectLighting?.source==='saved' && window.exportState().scene.userData.indirectLighting?.displayed`,240000)
 const state=await browser.evaluate('({gi:exportState().scene.userData.indirectLighting,exterior:exportState().scene.userData.exteriorSkyOcclusion})')
 writeFileSync('tmp/publish-springfield/verified-lighting.json',JSON.stringify(state,null,2))
 console.log('PASS refreshed export GI restores in the read-only tour')
}finally{browser.close()}
