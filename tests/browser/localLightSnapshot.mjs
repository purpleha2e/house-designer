import fs from 'node:fs'
import {createServer} from 'node:http'
import {pipeline} from 'node:stream/promises'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const out='docs/local-light',project=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/project.json.gz'))),cache=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/completed-baseline-cache.json.gz')))
project.indirectLighting=cache;project.sunPosition.strength=1
fs.writeFileSync('tmp/local-light-bedroom-project.json',JSON.stringify(project))
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5181')
 if(req.method!=='POST'||req.url!=='/bedroom-input.bin.gz'){res.statusCode=400;res.end();return}
 try{await pipeline(req,fs.createWriteStream(`${out}/bedroom-input.bin.gz`));res.end('saved')}catch(e){res.statusCode=500;res.end(String(e))}
})
await new Promise(resolve=>server.listen(9186,'127.0.0.1',resolve))
let b
try{
 b=await lightingBrowser()
 console.log('browser started')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=(url,...args)=>nativeFetch(typeof url==='string'&&url==='/tmp/bedroom-daylight-project.json'?'/tmp/local-light-bedroom-project.json':url,...args);window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}};`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-gi&bedroom-daylight&diagnostic-local-light'})
 console.log('navigated; waiting for completed field')
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 const actual=await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting().coefficients')
 console.log('field ready; validating coefficients')
 assert.deepEqual(actual,cache.coefficients,'Frozen completed coefficients must remain identical')
 await b.evaluate(`import('/tests/browser/localLightSnapshot.ts').then(m=>{window.localLightSnapshot=m;return true})`)
 await b.evaluate('window.snapshotDone=null;window.snapshotError=null;localLightSnapshot.localLightSnapshot(roofWallScene()).then(r=>window.snapshotDone=r).catch(e=>window.snapshotError=String(e));true')
 console.log('capturing reference scene')
 await b.wait('!!window.snapshotDone||!!window.snapshotError',600000)
 assert.equal(await b.evaluate('window.snapshotError'),null)
 const metadata=await b.evaluate('window.snapshotDone')
 fs.writeFileSync(`${out}/bedroom-snapshot.json`,JSON.stringify({metadata,errors:b.errors,coefficientsUnchanged:true},null,2))
 assert.deepEqual(b.errors,[]);console.log('saved bedroom snapshot',metadata.bytes)
}catch(e){fs.writeFileSync(`${out}/snapshot-failure.json`,JSON.stringify({error:String(e),errors:b?.errors}));throw e}
finally{b?.close();await new Promise(resolve=>server.close(resolve))}
