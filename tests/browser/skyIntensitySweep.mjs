import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gzipSync} from 'node:zlib'
import {evaluate,call,select,closeMenu,wait,ready,menu} from './skyIntensityClient.mjs'
const out='docs/sky-intensity',camera={position:[2.686065832319994,3.92763348726084,10.617238182516148],quaternion:[.0561699041984747,-.8864615860082525,-.11174699907917597,-.44558209859785225],fov:45}
await wait(ready)
await evaluate(`Promise.all([import('/tests/browser/skyIntensityMeasurement.ts'),import('/tests/browser/softGIView.ts')]).then(([m,v])=>{window.skyMeasure=m;window.skyView=v;return true})`)
await select('Soft floor GI radius',10);await closeMenu()
await wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`)
await evaluate(`(()=>{window.skyOriginalAssignments??=structuredClone(regressionAssignments);window.skyOriginalSun={...regressionSunPosition};const style=document.createElement('style');style.textContent='.viewport-toolbar,.three-performance-monitor,.lighting-performance-overlay{visibility:hidden!important}';document.head.append(style);return true})()`)
async function change(label,value){
 await menu();const previous=await evaluate('document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+').value');const before=await evaluate('roofWallScene().scene.userData.indirectLighting.generation'),t=Date.now()
 await select(label,value);await closeMenu();if(String(value)!==previous)await wait('roofWallScene().scene.userData.indirectLighting.generation>'+before);await new Promise(r=>setTimeout(r,500))
 await wait(ready);if(label==='Sky intensity')await wait('roofWallScene().scene.userData.getBakedIndirectLighting()?.settings.skyStrength==='+value);await wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`)
 return {latencyMs:Date.now()-t,before}
}
async function capture(name,settings,timing={},picture=true){
 await wait(ready)
 const result=await evaluate(`(async()=>{const s=roofWallScene(),v=skyView.softGIView(s);window.currentSkyView=v;v.setCamera(${JSON.stringify(camera)});let restore;try{restore=s.scene.userData.bindSoftFloorGI();const points=skyMeasure.skyReceivers(s),receivers=await skyMeasure.measureSkyMaterials(s,points),u=s.scene.userData.getIndirectUniforms();return {receivers,gi:JSON.parse(JSON.stringify(s.scene.userData.indirectLighting)),profile:s.scene.userData.getLightingPerformance(),calibration:{fill:u.hdGIIndoorFill.value,sky:u.hdSkyRadianceBase.value.toArray(),groundSun:u.hdSkySunIrradiance.value.toArray(),displaySky:u.hdSkyDisplayRadianceBase.value.toArray(),displayGroundSun:u.hdSkyDisplaySunIrradiance.value.toArray(),exposure:s.gl.toneMappingExposure,sun:regressionSunPosition},filter:s.scene.userData.softFloorGI,renderer:s.gl.info.memory,heap:performance.memory?.usedJSHeapSize}}finally{restore?.()}})()`)
 assert.equal(result.gi.fullPassPublications,6);assert.equal(result.gi.probes,301)
 if(picture){
  const hdr=await evaluate(`(async()=>{const s=roofWallScene(),restore=s.scene.userData.bindSoftFloorGI();try{return await currentSkyView.capture(false)}finally{restore?.()}})()`)
  fs.writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(hdr.hdr,'base64')));result.camera=hdr.camera
  const clip=await evaluate(`(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
  const shot=await call('Page.captureScreenshot',{format:'png',clip});fs.writeFileSync(`${out}/${name}.png`,Buffer.from(shot.data,'base64'))
  result.frames=await evaluate(`(async()=>{const restore=roofWallScene().scene.userData.bindSoftFloorGI();try{return await currentSkyView.frames()}finally{restore?.()}})()`)
 }
 result.coefficients=await evaluate('roofWallScene().scene.userData.getLightingField().coefficients.map(a=>Array.from(a))')
 await evaluate('currentSkyView.dispose();true')
 fs.writeFileSync(`${out}/${name}.json`,JSON.stringify({...settings,...timing,...result},null,2))
 console.log(name,JSON.stringify({latency:timing.latencyMs,bake:result.profile.totalMs,captured:result.gi.capturedFaces,relit:result.gi.surfaceRelitProbes,geometry:result.gi.geometryBuilds,gi:result.receivers.map(r=>[r.name,r.gi[1]])}))
}
for(const material of ((process.argv.includes('--white-only')||process.argv.includes('--white-loaded'))?['white']:['timeless','white'])){
 if(material==='white'&&!process.argv.includes('--white-loaded')){
  await evaluate(`(()=>{const timeless=regressionTools.surfaceMaterialsById.get('dulux-timeless-matt');regressionTools.registerRuntimeSurfaceMaterials([...regressionTools.surfaceMaterialsById.values(),{...timeless,id:'sky-calibration-white',productName:'Calibration white',pbr:{...timeless.pbr,baseColor:'#ffffff'}}]);window.skyWhiteAssignments=skyOriginalAssignments.map(a=>{
   const t=a.target,f=t.fragmentId??'',white=t.side===1&&(t.wallId==='6cccfa67-4575-4c05-a025-316c33a128dd'||t.wallId==='ddb019b5-cc88-4862-a03f-0182fb728f3b'&&f.includes(':10.3107:14.4054:')||t.wallId==='9b7e85a0-ee9b-4fcb-9f55-d237dae97e33'||t.wallId==='4f92da70-3afc-4dfd-8d96-f450b6bb9402'&&(f.includes('04edfb6d')||f.includes(':-13.466:-10.3092:')||f.includes(':-14.4039:-13.466:')));return white&&a.materialId==='dulux-timeless-matt'?{...a,materialId:'sky-calibration-white'}:a});updateRegressionAssignments(skyWhiteAssignments);return true})()`)
  await new Promise(r=>setTimeout(r,1000));await wait(ready);await wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`)
  fs.writeFileSync(`${out}/white-assignments.json`,JSON.stringify(await evaluate('skyWhiteAssignments.filter(a=>a.materialId==="sky-calibration-white")'),null,2))
 }
 await change('Sun strength',1)
 for(const sky of [.5,1,1.5,2,3,0]){const timing=await change('Sky intensity',sky);await capture(`${material}-sky-${sky}`,{material,sky,sun:1,fill:.18},timing,sky>0)}
 await change('Sun strength',0)
 for(const sky of [.5,1,1.5,2,3,0]){const timing=await change('Sky intensity',sky);await capture(`${material}-sky-only-${sky}`,{material,sky,sun:0,fill:.18},timing,false)}
 await change('Sun strength',1);await change('Sky intensity',1.5)
 for(const fill of [.04,0]){
  await menu();await evaluate(`(()=>{const e=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${fill}');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await closeMenu();await new Promise(r=>setTimeout(r,500));await wait(ready);await wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`)
  await capture(`${material}-fill-${fill}`,{material,sky:1.5,sun:1,fill})
 }
 await menu();await evaluate(`(()=>{const e=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'.18');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await closeMenu();await new Promise(r=>setTimeout(r,500));await wait(ready)
}
console.log('All sweeps complete')
