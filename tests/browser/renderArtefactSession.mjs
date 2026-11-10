import { lightingBrowser } from './lightingHarness.mjs'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const out='docs/render-artefacts/2026-11-03'
mkdirSync(out,{recursive:true});mkdirSync('tmp/render-artefacts',{recursive:true})
copyFileSync('Colin_house_v2.json','tmp/render-artefacts/project.json')
const raw=readFileSync('tmp/render-artefacts/project.json'),project=JSON.parse(raw)
writeFileSync(`${out}/input.json`,JSON.stringify({sha256:createHash('sha256').update(raw).digest('hex'),view:project.threeDView,sun:project.sunPosition,settings:project.indirectLighting.settings},null,2))
const browser=await lightingBrowser()
const server=createServer(async(req,res)=>{
  try{
    let data='';for await(const part of req)data+=part
    let result
    if(req.url==='/eval')result=await browser.evaluate(JSON.parse(data).expression)
    else if(req.url==='/shot'){
      const {name}=JSON.parse(data);if(!/^[a-z0-9_-]+$/i.test(name))throw Error('Invalid capture name')
      const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(png.data,'base64'));result={path:`${out}/${name}.png`}
    }else result={errors:browser.errors}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}))
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}))}
}).listen(9183,'127.0.0.1')
try{
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1310,height:888,deviceScaleFactor:1,mobile:false})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='#root,.editor-pane{height:888px!important}';document.head.append(style)})`})
  await browser.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?artefact-audit&materials&saved-colin'})
  await browser.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,360000)
  console.log('READY 9183')
}catch(error){console.error(error);server.close();browser.close();process.exitCode=1}
process.on('SIGINT',()=>{server.close();browser.close();process.exit()})
