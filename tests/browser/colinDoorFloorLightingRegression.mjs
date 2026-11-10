// Vite and the asset portal running: node tests/browser/colinDoorFloorLightingRegression.mjs [port]
import assert from 'node:assert/strict'
import {mkdirSync, writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const b = await lightingBrowser(), output = 'tmp/colin-door-floor'
mkdirSync(output, {recursive: true})
try {
  await b.call('Page.navigate', {url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/editorRegression.html?lightingDiagnostics`})
  await b.wait('!!window.perfScene?.()', 240000)
  await b.wait(`perfScene().scene.userData.progressiveStartup?.phase==='full' &&
    perfScene().scene.userData.indirectLighting?.state==='ready' &&
    perfScene().scene.userData.getLightingField?.()?.floorProbeLayoutVersion===2`, 360000)
  console.log('Colin coverage upgrade ready')
  const result = await b.evaluate(`(async()=>{
    const s=perfScene(), field=s.scene.userData.getLightingField();s.setFrameloop('never');
    const {loadIndirectLighting}=await import('/src/indirectLightingPersistence.ts');
    const {updateIndirectUniforms}=await import('/src/indirectLightingShader.ts');
    const {sampleBakedIndirectFloor}=await import('/src/indirectFloorLighting.ts');
    const {Vector3}=await import('/tests/browser/rendererTestModules.ts');
    const {createLightingDiagnosticDisplay}=await import('/src/lightingDiagnosticDisplay.ts');
    const project=await(await fetch('/colin_house_v2.json')).json();
    const old=await loadIndirectLighting(project.indirectLighting,{reflections:false,allowLegacy:true});
    s.camera.position.set(2.5,1.4,11.9);s.camera.lookAt(1.65,.85,14.4);s.camera.fov=65;
    s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld();
    const display=createLightingDiagnosticDisplay(s.gl,s.scene,s.camera);await display.preparation;
    const u=s.scene.userData.getIndirectUniforms(), normal=new Vector3(0,1,0);
    const render=f=>{updateIndirectUniforms(u,f);u.hdGIUseVolume.value=1;u.hdLightingDiagnostic.value=0;
      s.gl.setRenderTarget(null);display.render(s.scene,s.camera);return s.gl.domElement.toDataURL()};
    const before=render(old.field), after=render(field);
    const samples=[];
    for(const x of [2.4,2.6,2.8])for(const z of [14.1,14.3]){
      const p=new Vector3(x,.012,z);samples.push({x,z,before:sampleBakedIndirectFloor(old.field,0,p,normal),after:sampleBakedIndirectFloor(field,0,p,normal)});
    }
    const probes=field.probes.filter(p=>p.kind==='floor'&&p.position.distanceTo(new Vector3(2.8,.18,14.3))<1).map(p=>p.position.toArray());
    display.dispose();old.field.dispose();return {before,after,samples,probes,total:field.probes.length,version:field.floorProbeLayoutVersion};
  })()`)
  for (const name of ['before','after']) {writeFileSync(`${output}/${name}.png`,Buffer.from(result[name].split(',')[1],'base64'));delete result[name]}
  writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  const pocket=result.samples.find(p=>p.x===2.8&&p.z===14.3)
  assert.equal(pocket.before.coverage,0,'the saved Colin cache reproduces the uncovered door pocket')
  assert.ok(pocket.after.coverage>.99,'new measurements cover the exposed floor behind the open door')
  assert.ok(pocket.after.rgb.every(v=>v>.01),'the measured pocket receives indirect illumination')
  assert.ok(result.probes.length>0)
  assert.deepEqual(b.errors.filter(e=>!e.includes('BufferGeometryUtils:')),[])
} finally {b.close()}
