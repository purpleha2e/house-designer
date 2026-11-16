import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser(), output = 'tmp/springfield-exterior-roof-lighting'
mkdirSync(output, { recursive: true })
try {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/springfieldWallRegression.html?loft&materials` })
  await browser.wait('window.springfieldWallScene?.()?.scene.userData.progressiveStartup?.phase==="full"')
  console.log('Scene ready; comparing saved GI on the exterior roof')
  const result = await browser.evaluate(`(async()=>{
    const {loadIndirectLighting}=await import('/src/indirectLightingPersistence.ts');
    const {Vector3,Raycaster}=await import('/tests/browser/rendererTestModules.ts');
    const p=await(await fetch('/springfield_14.json')).json(),s=springfieldWallScene(),c=p.threeDView.camera;
    s.gl.setSize(640,492,false);
    s.camera.position.set(c.position.x,c.position.y,c.position.z);
    s.camera.quaternion.set(c.quaternion.x,c.quaternion.y,c.quaternion.z,c.quaternion.w);
    s.camera.updateMatrixWorld();s.scene.updateMatrixWorld(true);
    await s.gl.compileAsync(s.scene,s.camera);
    const saved=await loadIndirectLighting(p.indirectLighting,{reflections:false,allowLegacy:true});
    const {getIndirectLightingUniforms,updateIndirectUniforms}=springfieldGI;
    const attributes=new Set(),roofMeshes=[];
    s.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-top'){
        roofMeshes.push(o);const a=o.geometry.getAttribute('hdGIExteriorReceiver');if(a)attributes.add(a);
      }
      for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){
        const u=getIndirectLightingUniforms(m);if(u){updateIndirectUniforms(u,saved.field);u.hdGIUseVolume.value=1;}
      }
    });
    const context=s.gl.getContext(),width=context.drawingBufferWidth,height=context.drawingBufferHeight;
    const render=value=>{
      for(const a of attributes){a.array.fill(value);a.needsUpdate=true;}
      s.gl.setRenderTarget(null);s.gl.render(s.scene,s.camera);
      const pixels=new Uint8Array(width*height*4);context.readPixels(0,0,width,height,context.RGBA,context.UNSIGNED_BYTE,pixels);
      return {pixels,png:s.gl.domElement.toDataURL()};
    };
    const sun=s.scene.children.find(o=>o.userData.houseDesignerRole==='sun-light');
    if(sun)sun.shadow.needsUpdate=true;s.gl.shadowMap.needsUpdate=true;
    const before=render(0),after=render(1);
    const samples=[6.2,7,8.2].map(x=>{
      const hit=new Raycaster(new Vector3(x,10,2),new Vector3(0,-1,0)).intersectObjects(roofMeshes,false)[0];
      if(!hit)throw Error('Missing exterior roof sample');
      const screen=hit.point.clone().project(s.camera),px=Math.floor((screen.x+1)*width/2),py=Math.floor((screen.y+1)*height/2);
      const brightness=pixels=>{let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const i=((py+dy)*width+px+dx)*4;sum+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;}return sum/9};
      return {point:hit.point.toArray(),before:brightness(before.pixels),after:brightness(after.pixels)};
    });
    saved.field.dispose();return {before:before.png,after:after.png,samples,attributes:attributes.size,glError:context.getError()};
  })()`)
  for (const name of ['before', 'after']) {
    writeFileSync(`${output}/${name}.png`, Buffer.from(result[name].split(',')[1], 'base64'))
    delete result[name]
  }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2))
  assert.ok(result.attributes > 0)
  for (const sample of result.samples) assert.ok(sample.after > sample.before + 25,
    `Exterior tile must receive sky rather than loft lighting: ${JSON.stringify(sample)}`)
  assert.equal(result.glError, 0)
  assert.deepEqual(browser.errors, [])
  console.log('PASS saved Springfield roof lighting', result)
} finally { browser.close() }
