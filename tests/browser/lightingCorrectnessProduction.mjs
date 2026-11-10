import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,out=process.argv[3]??'docs/lighting-correctness'
mkdirSync(out,{recursive:true})
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync('tmp/lighting-correctness-cache.json','utf8')}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
  await b.wait('!!window.roofWallScene?.()')
  await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`)
  await b.wait(`roofWallScene().scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
  const result=await b.evaluate(`(async()=>{
    const s=roofWallScene(),m=await import('/tests/browser/kitchenFrameMeasurements.ts'),t=await import('/tests/browser/rendererTestModules.ts');let composer;const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)};visit(t.getEditorFiber());
    const wasActive=s.internal.active;s.internal.active=false;
    s.camera.position.set(4.65,1.6,9.95);s.camera.lookAt(2.1,1.25,4.95);s.camera.fov=60;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);
    const ao=composer.passes.find(p=>'configuration'in p),lights=[];s.scene.traverseVisible(o=>{if(o.isLight&&o.shadow)lights.push(o)});const values=lights.map(l=>l.shadow.intensity),u=s.scene.userData.getIndirectUniforms();
    let forceShadow=false;const originalShadowRender=s.gl.shadowMap.render;s.gl.shadowMap.render=function(...args){if(forceShadow&&this.autoUpdate){lights.filter(l=>l.isDirectionalLight).forEach(l=>l.shadow.needsUpdate=true);this.needsUpdate=true}return originalShadowRender.apply(this,args)};
    let result;try{result=await m.measureKitchenFrames(s,composer,{cases:[['unchanged normal production renderer',()=>{}],['AO disabled',()=>ao.enabled=false],['shadow filtering disabled',()=>lights.forEach(l=>l.shadow.intensity=0)],['shadow map regeneration',()=>forceShadow=true],['probe shader branch bypassed',()=>u.hdGIEnabled.value=0]],restore:()=>{forceShadow=false;ao.enabled=true;lights.forEach((l,i)=>l.shadow.intensity=values[i])}})}finally{s.gl.shadowMap.render=originalShadowRender;s.internal.active=wasActive}
    return{...result,diagnosticsLoaded:!!s.scene.userData.lightingDiagnostics,memory:s.gl.info.memory,programs:s.gl.info.programs.length,gi:s.scene.userData.indirectLighting,exposure:s.gl.toneMappingExposure}
  })()`)
  assert.equal(result.diagnosticsLoaded,false);assert.ok(result.generationUnchanged);assert.deepEqual(b.errors,[])
  writeFileSync(`${out}/production-performance.json`,JSON.stringify(result,null,2));console.log('PASS normal production renderer without diagnostic shader family',JSON.stringify(result.cases))
}finally{b.close()}
