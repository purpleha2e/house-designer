import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/colin-contact-fix/baseline';mkdirSync(out,{recursive:true})
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json','utf8')}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`});console.log('LOAD physical geometry')
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 const data=await b.evaluate(`(async()=>{const s=roofWallScene(),m=await import('/src/indirectVisibility.ts'),v=m.createIndirectVisibility(s.scene);try{const snapshot=v.snapshot(),bytes=new Uint8Array(snapshot.positions.buffer,snapshot.positions.byteOffset,snapshot.positions.byteLength);let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));return{positions:btoa(str),triangles:snapshot.positions.length/9}}finally{v.dispose()}})()`)
 writeFileSync(`${out}/geometry.f32.gz`,gzipSync(Buffer.from(data.positions,'base64')))
 writeFileSync(`${out}/geometry.json`,JSON.stringify({triangles:data.triangles,modelSHA256:createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex'),fieldSHA256:createHash('sha256').update(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')).digest('hex')},null,2));console.log('PASS persisted physical triangles',data.triangles)
}finally{b.close()}
