import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const browser=await lightingBrowser(),output=process.argv[3]??'tmp/springfield-wall-regression'
mkdirSync(output,{recursive:true})
try{
 await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/springfieldWallRegression.html?lightingDiagnostics`})
 await browser.wait('window.springfieldWallScene?.()?.scene.userData.progressiveStartup?.phase==="full"')
 await browser.evaluate(`(async()=>{
  const {Raycaster,Vector3}=await import('/tests/browser/rendererTestModules.ts');
  const {getWallOpeningPreview}=await import('/src/wallOpeningPreview.ts');
  const state=springfieldWallScene(),render=state.gl.render;
  state.gl.render=function(scene,camera){if(camera===state.camera)window.springfieldDisplay=scene;return render.call(this,scene,camera)};
  window.inspectSpringfieldWalls=(display=false)=>{
   const s=springfieldWallScene(),meshes=[],scene=display?window.springfieldDisplay:s.scene;if(!scene)return null;scene.updateMatrixWorld(true);
   scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)});
   const samples=[
    {name:'fawn-west',origin:[10.8,1.2,6.7],direction:[-1,0,0]},
    {name:'fawn-north',origin:[11,1.2,6.7],direction:[0,0,-1]},
    {name:'fawn-east',origin:[11.4,1.2,7],direction:[1,0,0]},
    {name:'fawn-south',origin:[11,1.2,8.1],direction:[0,0,1]},
    {name:'painted-fragment',origin:[5.8,1.2,6.2],direction:[-1,0,0]},
    {name:'closed-junction',origin:[5.8,1.2,8.35],direction:[-1,0,0]},
   ].map(({name,origin,direction})=>{
    const ray=new Raycaster(new Vector3(...origin),new Vector3(...direction));
    const hits=ray.intersectObjects(meshes,false).filter(h=>h.distance<.3);
    const h=hits[0],m=h?.object.material[h.face.materialIndex];
    return {name,hits:hits.filter(hit=>hit.distance<=h.distance+.001).length,color:m?.color.getHexString(),point:h?.point.toArray()};
   });
   const preview=getWallOpeningPreview(s.scene);preview.sync(s.scene);
   return {samples,cuts:preview.uniforms.hdOpeningPreviewCount.value,patches:preview.group.children.length,
    retained:scene!==s.scene,baseline:meshes.find(m=>m.userData.floorId===springfieldFloors[0].id)?.userData.wallPreparedWalls.find(w=>w.id==='ad6be6e9-bee5-462e-afd3-bfa7ca58a686')};
  };
 })()`)
 const baseline=await browser.evaluate('inspectSpringfieldWalls()')
 assert.equal(baseline.cuts,0,'normal topology snapping must not cut an unchanged wall')
 assert.equal(baseline.patches,0,'unchanged fragment finishes must not be covered by replacement boxes')
 assert.equal(baseline.baseline.start.y,8.286993011402602,'the preview baseline retains the authored endpoint, before its 15 cm topology extension')
 for(const sample of baseline.samples){
  assert.equal(sample.hits,1,`${sample.name} must have one nearby wall skin, without a gap or overlapping faces`)
  if(sample.name.startsWith('fawn-'))assert.equal(sample.color,'a59387',sample.name)
 }
 assert.equal(baseline.samples.find(s=>s.name==='painted-fragment').color,'eee9dc')
 await browser.evaluate(`updateSpringfieldAssignments(springfieldAssignments.map(a=>a.target.wallId==='ad6be6e9-bee5-462e-afd3-bfa7ca58a686'&&a.target.type==='wall-surface-fragment'?{...a,materialId:'local-material-f3364549-7e0d-4b67-a0ac-139780d98b6f'}:a))`)
 await browser.wait(`inspectSpringfieldWalls().samples.find(s=>s.name==='painted-fragment').color==='a59387'`)
 const edited=await browser.evaluate('inspectSpringfieldWalls()')
 assert.equal(edited.cuts,0);assert.equal(edited.patches,0)
 await browser.evaluate(`(()=>{const s=springfieldWallScene();s.camera.position.x+=.00001;s.invalidate()})()`)
 await browser.wait(`inspectSpringfieldWalls(true)?.samples.find(s=>s.name==='painted-fragment').color==='a59387'`)
 const displayed=await browser.evaluate('inspectSpringfieldWalls(true)')
 // Inspect albedo without relying on a furniture-dependent lighting bake.
 await browser.evaluate(`houseDesignerLighting.setMode('Albedo')`)
 await browser.wait(`houseDesignerLighting.mode==='Albedo'`)
 await new Promise(resolve=>setTimeout(resolve,600))
 const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${output}/junction.png`,Buffer.from(png.data,'base64'))
 await browser.evaluate(`(()=>{const s=springfieldWallScene();s.camera.position.set(6.8,1.5,6.4);s.camera.lookAt(5.55,1.3,6.2);s.camera.updateMatrixWorld();s.invalidate()})()`)
 await new Promise(resolve=>setTimeout(resolve,200))
 const fawn=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${output}/fawn.png`,Buffer.from(fawn.data,'base64'))
 assert.deepEqual(browser.errors,[])
 writeFileSync(`${output}/result.json`,JSON.stringify({baseline,edited,displayed},null,2))
 console.log('PASS Springfield saved Gentle Fawn, fragment repaint, closed junction and absence of false edit previews',JSON.stringify({cuts:edited.cuts,patches:edited.patches,samples:baseline.samples}))
}finally{browser.close()}
