import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='tmp/springfield-stair-band';mkdirSync(out,{recursive:true});
const project=JSON.parse(readFileSync('springfield_14.json','utf8'));
project.threeDView.camera={position:{x:11.32108319024352,y:4.221648906324175,z:7.202579366604677},quaternion:{x:.040758942106824216,y:-.8855780114934274,z:-.4558740268645268,w:-.07917806405817374}};
const wait=async(e,timeout=600000)=>{const end=Date.now()+timeout;while(!await b.evaluate(e)){if(Date.now()>end)throw Error(e);await new Promise(r=>setTimeout(r,250))}};
try{
await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});
await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(i,o)=>f(String(i?.url??i).includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')?'/src/models/assets/interior_door_closed.glb':i,o);window.confirm=()=>false;window.showOpenFilePicker=async()=>[{getFile:async()=>new File([await(await fetch('/springfield_14.json')).text()],'springfield_14.json')}];`});
await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/editorRegression.html?lightingDiagnostics'});
await wait('!!window.perfScene?.()');
await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);
await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);
await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`);
await wait(`perfScene().scene.userData.indirectLighting?.probes>300&&!document.querySelector('.viewport-preparing-overlay')&&!perfScene().scene.userData.shaderWarmupPending`);
await b.evaluate(`(()=>{const s=perfScene(),c=${JSON.stringify(project.threeDView.camera)};document.querySelector('.editor-grid').style.gridTemplateColumns='200px 8px minmax(0,1fr)';s.camera.position.set(c.position.x,c.position.y,c.position.z);s.camera.quaternion.set(c.quaternion.x,c.quaternion.y,c.quaternion.z,c.quaternion.w);s.camera.updateMatrixWorld();s.invalidate()})()`);
const capture=async(name,code)=>{await b.evaluate(code);await new Promise(r=>setTimeout(r,1200));const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(p.data,'base64'));console.log(name)};
await capture('initial','perfScene().invalidate()');
console.log('Loaded',JSON.stringify(await b.evaluate('perfScene().scene.userData.indirectLighting')));
await wait(`(()=>{const g=perfScene().scene.userData.indirectLighting;return g?.state==='ready'&&!g.preparing&&!g.warming&&!g.pendingLighting&&!g.saving})()`);
await capture('fixed','perfScene().invalidate()');
const band=await b.evaluate(`(async()=>{const {Vector3}=await import('/tests/browser/rendererTestModules.ts');const s=perfScene(),point=new Vector3(11.13375279106417,2.007188320159912,8.28379367599665),rect=s.gl.domElement.getBoundingClientRect(),pixel=point.clone().project(s.camera);window.bandMasks=[];const seen=new Set();s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){const u=s.gl.properties.get(m).uniforms,t=u?.hdGIMask?.value,b=u?.hdGIBounds?.value;if(!t||seen.has(t))continue;seen.add(t);const x=Math.floor((point.x-b.x)/b.z*512),z=Math.floor((point.z-b.y)/b.z*512);if(!t.image.data[(z*512+x)*4])throw Error('Partition is still classified outdoors');bandMasks.push({t,backup:t.image.data.slice()});for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++)t.image.data[((z+dz)*512+x+dx)*4]=0;t.needsUpdate=true}});s.invalidate();return {x:Math.round(rect.left+(pixel.x+1)*rect.width/2),y:Math.round(rect.top+(1-pixel.y)*rect.height/2)}})()`);
await capture('old-mask','perfScene().invalidate()');
const sample=async name=>{const data=await sharp(out+'/'+name+'.png').extract({left:band.x-2,top:band.y-2,width:5,height:5}).removeAlpha().raw().toBuffer();return data.reduce((s,v)=>s+v,0)/data.length};
const fixed=await sample('fixed'),old=await sample('old-mask');assert.ok(old>fixed*1.3,JSON.stringify({old,fixed}));
await b.evaluate(`bandMasks.forEach(({t,backup})=>{t.image.data.set(backup);t.needsUpdate=true});document.querySelector('button[aria-controls="three-settings-menu"]').click()`);
await wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows')`);
await b.evaluate(`window.shadowInput=()=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(!shadowInput().checked)shadowInput().click();document.querySelector('#three-settings-menu').style.visibility='hidden'`);
const move=async(x,z,lampX)=>{await b.evaluate(`(()=>{const s=perfScene();s.camera.position.set(${x},4.1,${z});s.camera.lookAt(${x}-.4,3.8,${z}-3.6);s.camera.updateMatrixWorld();s.invalidate()})()`);await wait(`perfScene().scene.children.some(o=>o.isPointLight&&o.castShadow&&o.shadow.intensity>0&&Math.abs(o.position.x-${lampX})<.001)`);await new Promise(r=>setTimeout(r,1500))};
await move(8.4,5.5,7.80593610881338);
await capture('bedroom-shadows-on','perfScene().invalidate()');
await b.evaluate(`window.beforeShadowMove={programs:perfScene().gl.info.programs.map(p=>p.id),generation:perfScene().scene.userData.indirectLighting.generation,maps:perfScene().scene.children.filter(o=>o.isPointLight&&o.castShadow).map(o=>o.shadow.map)};true`);
await move(13,10,13.175269955661573);await move(8.4,5.5,7.80593610881338);
const stable=await b.evaluate(`({programs:JSON.stringify(beforeShadowMove.programs)===JSON.stringify(perfScene().gl.info.programs.map(p=>p.id)),generation:beforeShadowMove.generation===perfScene().scene.userData.indirectLighting.generation,maps:perfScene().scene.children.filter(o=>o.isPointLight&&o.castShadow).every((o,i)=>o.shadow.map===beforeShadowMove.maps[i])})`);assert.deepEqual(stable,{programs:true,generation:true,maps:true});
await capture('bedroom-shadows-off',`shadowInput().click();perfScene().invalidate()`);
const pixels=async name=>sharp(out+'/'+name+'.png').extract({left:400,top:500,width:900,height:350}).removeAlpha().raw().toBuffer();
const on=await pixels('bedroom-shadows-on'),off=await pixels('bedroom-shadows-off');let shadowPixels=0;for(let i=0;i<on.length;i+=3)if(off[i]+off[i+1]+off[i+2]-on[i]-on[i+1]-on[i+2]>30)shadowPixels++;
assert.ok(shadowPixels>100,'bedroom furnishings must cast visible local-light shadows');
assert.deepEqual(b.errors.filter(e=>!e.includes('BufferGeometryUtils:')),[]);
writeFileSync(out+'/result.json',JSON.stringify({old,fixed,stable,shadowPixels},null,2));console.log('PASS',JSON.stringify({old,fixed,stable,shadowPixels}));
}finally{b.close()}
