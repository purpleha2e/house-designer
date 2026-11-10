import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gzipSync} from 'node:zlib'
import {evaluate,call,wait,ready,menu,select,closeMenu} from './sunBounceClient.mjs'
const out='docs/sun-bounce-strength',material=process.argv.includes('--white')?'white':'timeless',camera=JSON.parse(fs.readFileSync(out+'/inputs.json')).camera
await wait(`!!window.roofWallScene?.()?.scene.userData.getLightingField`)
await wait(ready)
await evaluate(`Promise.all([import('/tests/browser/sunBounceMeasurement.ts'),import('/tests/browser/sunBounceView.ts')]).then(([m,v])=>{window.bounceMeasure=m;window.bounceView=v;return true})`)
await select('Soft floor GI radius',10);await closeMenu();await wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`)
await evaluate(`(()=>{window.bounceOriginal=roofWallScene().scene.userData.getLightingField().coefficients.map(a=>a.slice());window.bounceGeneration=roofWallScene().scene.userData.indirectLighting.generation;window.bounceSaved=JSON.stringify(roofWallScene().scene.userData.getBakedIndirectLighting());const style=document.createElement('style');style.textContent='.viewport-toolbar,.three-performance-monitor,.lighting-performance-overlay{visibility:hidden!important}';document.head.append(style);return true})()`)
async function strength(value){
 await menu()
 const result=await evaluate(`(async()=>{const s=roofWallScene(),e=document.querySelector('[aria-label="Sun Bounce Strength (Experimental)"]'),u=s.scene.userData.getIndirectUniforms(),at=performance.now();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${value}');e.dispatchEvent(new Event('input',{bubbles:true}));for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);if(u.hdSunBounceStrength.value===${value})return{uniformLatencyMs:performance.now()-at}}throw Error('Slider did not update')})()`)
 await closeMenu()
 if(value!==1)await wait(`(()=>{const d=roofWallScene().scene.userData;return d.sunBounceExperiment?.ready&&d.sunBounceExperiment.strength===${value}&&d.sunOffSoftFloorGI?.state==='ready'})()`)
 return result
}
async function capture(value,timing){
 const result=await evaluate(`(async()=>{const s=roofWallScene(),d=s.scene.userData,u=d.getIndirectUniforms();window.currentBounceView=bounceView.sunBounceView(s);currentBounceView.view.setCamera(${JSON.stringify(camera)});const a=d.bindSoftFloorGI?.(),b=d.bindSunOffSoftFloorGI?.(),c=d.bindSunBounceGI?.();try{const points=await bounceMeasure.sunBounceReceivers(s),receivers=await bounceMeasure.measureSkyMaterials(s,points),hdr=await currentBounceView.view.capture(false),gi=await currentBounceView.gi(),frames=await currentBounceView.view.frames();if(!bounceOriginal.every((a,c)=>a.every((v,i)=>v===d.getLightingField().coefficients[c][i])))throw Error('Transport field mutated');if(bounceSaved!==JSON.stringify(d.getBakedIndirectLighting()))throw Error('Persistent cache changed');return{receivers,hdr,gi,frames,status:{...d.sunBounceExperiment,key:undefined},generation:d.indirectLighting.generation,geometryBuilds:d.indirectLighting.geometryBuilds,passes:d.indirectLighting.fullPassPublications,probes:d.indirectLighting.probes,filter:d.softFloorGI,offFilter:d.sunOffSoftFloorGI,memory:s.gl.info.memory,heap:performance.memory?.usedJSHeapSize,settings:d.getBakedIndirectLighting()?.settings,sun:regressionSunPosition,fill:u.hdGIIndoorFill.value,exposure:s.gl.toneMappingExposure,glError:s.gl.getContext().getError()}}finally{c?.();b?.();a?.()}})()`)
 const clip=await evaluate(`(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`),shot=await call('Page.captureScreenshot',{format:'png',clip})
 fs.writeFileSync(`${out}/${material}-${value}.png`,Buffer.from(shot.data,'base64'))
 fs.writeFileSync(`${out}/${material}-${value}.rgba16f.gz`,gzipSync(Buffer.from(result.hdr.hdr,'base64')))
 fs.writeFileSync(`${out}/${material}-${value}-gi.rgba16f.gz`,gzipSync(Buffer.from(result.gi.hdr,'base64')))
 result.camera=result.hdr.camera;result.width=result.gi.width;result.height=result.gi.height;delete result.hdr;delete result.gi
 assert.equal(result.passes,6);assert.equal(result.probes,301);assert.equal(result.glError,0)
 result.material=material;result.multiplier=value;result.timing=timing
 fs.writeFileSync(`${out}/${material}-${value}.json`,JSON.stringify(result,null,2))
 await evaluate('currentBounceView.dispose();true')
 console.log(JSON.stringify({material,value,latency:timing.uniformLatencyMs,preparation:result.status.preparationMs,builds:result.geometryBuilds,generation:result.generation,gi:result.receivers.map(r=>[r.name,r.gi[1]])}))
}
await capture(1,{uniformLatencyMs:0,baseline:true})
for(const suffix of ['json','png','rgba16f.gz','-gi.rgba16f.gz']){const name=suffix.startsWith('-')?`${material}-1${suffix}`:`${material}-1.${suffix}`;fs.copyFileSync(`${out}/${name}`,`${out}/${name.replace('-1','-baseline')}`)}
for(const value of (material==='white'?[0,2,4,1]:[0,1,1.5,2,3,4]))await capture(value,await strength(value))
const rapid=await evaluate(`(async()=>{const d=roofWallScene().scene.userData,before=d.indirectLighting.generation,field=d.getLightingField(),off=d.getSunBounceFields().sunOff,results=[];document.querySelector('[aria-label="3D view menu"]').click();for(const value of [4,0,3,.25,2.75,1,4,1.5]){const e=document.querySelector('[aria-label="Sun Bounce Strength (Experimental)"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);results.push({value,displayed:d.getIndirectUniforms().hdSunBounceStrength.value})}document.querySelector('[aria-label="3D view menu"]').click();return{before,after:d.indirectLighting.generation,sameFull:field===d.getLightingField(),sameOff:off===d.getSunBounceFields().sunOff,results}})()`)
assert.equal(rapid.before,rapid.after);assert.ok(rapid.sameFull&&rapid.sameOff);assert.ok(rapid.results.every(r=>r.value===r.displayed))
fs.writeFileSync(`${out}/${material}-rapid.json`,JSON.stringify(rapid,null,2))
console.log('Sweep and rapid input checks passed')
