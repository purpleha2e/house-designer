import fs from 'node:fs'
import {whiteSkyProject} from './skyIntensityProject.mjs'
import crypto from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {createServer} from 'node:http'
import {pipeline} from 'node:stream/promises'
import {lightingBrowser} from './lightingHarness.mjs'
if(!process.argv.includes('--sun-bounce'))throw Error('Diagnostic opt-in required')
const out='docs/sun-bounce-strength';fs.mkdirSync(out,{recursive:true})
const source=fs.readFileSync('colin_house_v2.json'),project=JSON.parse(source);project.sunPosition.strength=1;project.indirectLighting.settings.skyStrength=1;project.indirectLighting.settings.ambientTerm=.18
fs.writeFileSync(`${out}/project.json.gz`,gzipSync(source));fs.writeFileSync(`${out}/inputs.json`,JSON.stringify({source:'colin_house_v2.json',sha256:crypto.createHash('sha256').update(source).digest('hex'),sun:project.sunPosition,camera:project.threeDView.camera,settings:project.indirectLighting.settings},null,2))
if(process.argv.includes('--white')){
 whiteSkyProject(project);fs.writeFileSync(out+'/white-assignments.json',JSON.stringify(project.surfaceAssignments.filter(a=>a.materialId==='sky-calibration-white'),null,2));fs.writeFileSync(out+'/white-project.json.gz',gzipSync(JSON.stringify(project)));
}
project.indirectLighting.projectKey='sun-bounce-force-fresh';fs.writeFileSync('tmp/sun-bounce-project.json',JSON.stringify(project))
const b=await lightingBrowser()
const server=createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5181');try{
 if(req.method!=='POST')throw Error('POST only')
 if(req.url?.startsWith('/save/')){const name=req.url.slice(6);if(!/^[a-zA-Z0-9._-]+$/.test(name))throw Error('Invalid filename');await pipeline(req,fs.createWriteStream(`${out}/${name}`));res.end('saved');return}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString())
 if(req.url==='/evaluate')res.end(JSON.stringify({value:await b.evaluate(request.expression)}))
 else if(req.url==='/call')res.end(JSON.stringify({value:await b.call(request.method,request.params)}))
 else if(req.url==='/close'){res.end('{}');b.close();server.close()}
 else throw Error('Unknown command')
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}))}})
await new Promise(resolve=>server.listen(9189,'127.0.0.1',resolve))
await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=(url,...args)=>nativeFetch(typeof url==='string'&&url==='/tmp/bedroom-daylight-project.json'?'/tmp/sun-bounce-project.json':url,...args);`})
await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&sky-intensity&lightingProfile=1'})
await b.wait('!!window.roofWallScene?.()?.scene.userData.getLightingField',600000)
await b.evaluate(`import('/tests/browser/bedroomDaylight.ts').then(m=>{window.sunlitTrace=m.installBedroomTrace(roofWallScene());return true})`)
console.log('sun bounce session ready for commands; tracing fresh baseline')
await b.wait(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
fs.writeFileSync(`${out}/${process.argv.includes('--white')?'white-':''}baseline-cache.json.gz`,gzipSync(JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()'))))
fs.writeFileSync(`${out}/${process.argv.includes('--white')?'white-':''}baseline-trace.json`,JSON.stringify(await b.evaluate('sunlitTrace.state()')))
fs.writeFileSync(`${out}/${process.argv.includes('--white')?'white-':''}baseline-profile.json`,JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getLightingPerformance()')))
console.log('fresh current-house baseline complete; session retained')
