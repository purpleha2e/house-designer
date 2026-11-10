import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/gi-barrier-filtering/house',cache=readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json','utf8'),old=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json','utf8')).results,gpu=JSON.parse(readFileSync(`${out}/receivers.json`,'utf8')).modes.legacy,points=old.map(p=>({...p,floorIndex:gpu.find(q=>q.name===p.name&&q.camera===p.camera).floorIndex,reference:undefined}))
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 const r=await b.evaluate(`(async()=>{const s=roofWallScene(),f=await import('/src/indirectLighting.ts'),g=await import('/src/indirectVisibility.ts'),field=s.scene.userData.getLightingField();return new Promise((resolve,reject)=>{const worker=new Worker('/tests/browser/giBarrierDiagnostics.worker.ts',{type:'module'});worker.onmessage=e=>{worker.terminate();if(!e.data.ok){reject(Error(e.data.error));return}const r=e.data;r.maps=r.maps.map(m=>{let bytes='';for(let i=0;i<m.data.length;i+=32768)bytes+=String.fromCharCode(...m.data.subarray(i,i+32768));return{...m,data:btoa(bytes)}});resolve(r)};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({field:f.serializeIndirectField(field),geometry:g.snapshotIndirectGeometry(s.scene),volume:field.volume.data,floor:field.floorLayer.data,points:${JSON.stringify(points)}})})})()`)
 for(const map of r.maps){await sharp(Buffer.from(map.data,'base64'),{raw:{width:map.width,height:map.height,channels:3}}).resize(map.width*2,map.height*2,{kernel:'nearest'}).png().toFile(`${out}/barriers-${map.mode}-${map.layer}-${map.floor}.png`);delete map.data}
 writeFileSync(`${out}/barrier-diagnostics.json`,JSON.stringify(r,null,2));assert.deepEqual(b.errors,[]);console.log('PASS geometry-only floor/volume metadata maps and 39 receiver tap diagnostics')
}finally{b.close()}
