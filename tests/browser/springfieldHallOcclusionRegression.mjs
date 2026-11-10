import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='tmp/hall-occlusion-regression';mkdirSync(out,{recursive:true});
const project=JSON.parse(readFileSync('springfield_14.json','utf8'));
const wait=async(e,timeout=600000)=>{const end=Date.now()+timeout;while(!await b.evaluate(e)){if(Date.now()>end)throw Error(e);await new Promise(r=>setTimeout(r,250))}};
try{
await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});
await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(i,o)=>f(String(i?.url??i).includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')?'/src/models/assets/interior_door_closed.glb':i,o);window.confirm=()=>false;window.showOpenFilePicker=async()=>[{getFile:async()=>{const p=await(await fetch('/springfield_14.json')).json();p.floors[0].models.find(m=>m.id==='6b994a32-4a8c-4114-97d2-4db97917b5cc').lightEnabled=true;return new File([JSON.stringify(p)],'springfield_14.json')}}];`});
await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/editorRegression.html?lightingDiagnostics'});
await wait('!!window.perfScene?.()');
await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);
await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);
await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`);
await wait(`perfScene().scene.userData.indirectLighting?.probes>300&&!document.querySelector('.viewport-preparing-overlay')&&!perfScene().scene.userData.shaderWarmupPending`);
await b.evaluate(`(()=>{const s=perfScene(),c=${JSON.stringify(project.threeDView.camera)};document.querySelector('.editor-grid').style.gridTemplateColumns='200px 8px minmax(0,1fr)';s.scene.getObjectByName('model-transform-1caa60eb-eca4-433d-873b-8cd9ac179bce').visible=false;s.camera.position.set(11.2,3.4,8.4);s.camera.lookAt(10.7,.4,11.7);s.camera.updateMatrixWorld();s.invalidate()})()`);
const capture=async(name,code)=>{await b.evaluate(code);await new Promise(r=>setTimeout(r,1200));const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(p.data,'base64'));console.log(name)};
await capture('initial','perfScene().invalidate()');
console.log('Loaded',JSON.stringify(await b.evaluate('perfScene().scene.userData.indirectLighting')));
await wait(`(()=>{const g=perfScene().scene.userData.indirectLighting;return g?.state==='ready'&&!g.preparing&&!g.warming&&!g.pendingLighting&&!g.saving})()`);

await b.evaluate(`houseDesignerLighting.setMode('Direct lighting only');document.querySelector('button[aria-controls="three-settings-menu"]').click()`);
const results=[];
const sharp=(await import('sharp')).default;
const assert=(await import('node:assert/strict')).default;
for(const shadows of [false,true]){
 await b.evaluate(`(()=>{const i=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(i.checked!==${shadows})i.click();document.querySelector('#three-settings-menu').style.visibility='hidden'})()`);
 const pixels=[];
 for(const on of [false,true]){
  await capture(`${shadows?'shadows':'fallback'}-${on?'on':'off'}`,`(()=>{const s=perfScene(),lamp=s.scene.children.find(o=>o.isPointLight&&Math.abs(o.position.x-9.834935)<.001);lamp.power=${on?12:0};s.scene.userData.liveLightRevision++;s.invalidate()})()`);
  pixels.push(await sharp(`${out}/${shadows?'shadows':'fallback'}-${on?'on':'off'}.png`).extract({left:480,top:20,width:300,height:130}).removeAlpha().raw().toBuffer());
 }
 let leaks=0,max=0;for(let i=0;i<pixels[0].length;i+=3){const delta=Math.max(...[0,1,2].map(c=>pixels[1][i+c]-pixels[0][i+c]));max=Math.max(max,delta);if(delta>3)leaks++}
 results.push({shadows,leaks,max});assert.equal(leaks,0,'the enclosed lamp must not project door/stair tessellation onto the upper stairwell');
}
await b.evaluate(`houseDesignerLighting.setMode('Final composite')`);
await capture('final','perfScene().invalidate()');
assert.deepEqual(b.errors.filter(e=>!e.includes('BufferGeometryUtils:')),[]);
writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));
if(process.argv.includes('--keep')){await b.evaluate('window.auditReady=true');await wait('window.auditDone',2400000)}
}finally{b.close()}
