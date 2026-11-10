import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const browser=await lightingBrowser(),output=process.argv[3]??'tmp/springfield-roof-regression'
mkdirSync(output,{recursive:true})
try{
 await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/springfieldWallRegression.html?loft`})
 await browser.wait('window.springfieldWallScene?.()?.scene.userData.progressiveStartup?.phase==="full"')
 const result=await browser.evaluate(`(async()=>{
  const {loadIndirectLighting}=await import('/src/indirectLightingPersistence.ts');
  const {updateIndirectUniforms,getIndirectLightingUniforms}=window.springfieldGI;
  const {Raycaster,Vector3}=await import('/tests/browser/rendererTestModules.ts');
  const project=await(await fetch('/springfield_14.json')).json();
  const saved=await loadIndirectLighting(project.indirectLighting,{reflections:false,allowLegacy:true});
  const s=springfieldWallScene(),{scene,camera,gl}=s;
  if(${process.argv.includes('--original-sampling')}){
   const seen=new Set();scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){
    if(seen.has(m)||!getIndirectLightingUniforms(m))continue;seen.add(m);
    const hook=m.onBeforeCompile,key=m.customProgramCacheKey;
    m.onBeforeCompile=function(shader,renderer){hook.call(this,shader,renderer);
     const start=shader.fragmentShader.indexOf('      // Occupancy stays discrete.');
     const end=shader.fragmentShader.indexOf('      return mask.r',start);
     if(start>=0&&end>start)shader.fragmentShader=shader.fragmentShader.slice(0,start)+shader.fragmentShader.slice(end);
     shader.fragmentShader=shader.fragmentShader.replace('min(centreShadow, shadow * .2)','shadow * .2');
    };m.customProgramCacheKey=()=>key.call(m)+':original-seam-sampling';m.needsUpdate=true;
   }});
  }
  // The small fixture omits unrelated furniture. Bind the original saved GI
  // explicitly so a cache-key mismatch cannot silently test an unlit room.
  const bind=(display)=>{const seen=new Set();display.traverse(o=>{
   for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){
    const u=getIndirectLightingUniforms(m);if(u&&!seen.has(u)){updateIndirectUniforms(u,saved.field);u.hdGIUseVolume.value=1;seen.add(u)}
   }
  });return seen.size};
  let bindings=0;
  camera.position.set(9.5,6.6,8.94);camera.lookAt(5.6,7.2,8.94);camera.updateMatrixWorld();scene.updateMatrixWorld(true);
  await gl.compileAsync(scene,camera);
  const sun=scene.children.find(o=>o.userData.houseDesignerRole==='sun-light'),intensity=sun.intensity;
  const context=gl.getContext(),width=context.drawingBufferWidth,height=context.drawingBufferHeight;
  const render=()=>{bindings=bind(scene);gl.setRenderTarget(null);sun.shadow.needsUpdate=true;gl.shadowMap.needsUpdate=true;gl.render(scene,camera);
   const pixels=new Uint8Array(width*height*4);context.readPixels(0,0,width,height,context.RGBA,context.UNSIGNED_BYTE,pixels);return pixels};
  const lit=render(),png=gl.domElement.toDataURL('image/png');sun.intensity=0;const dark=render();sun.intensity=intensity;
  const pixel=(p)=>{const v=p.clone().project(camera);return [Math.floor((v.x+1)*width/2),Math.floor((v.y+1)*height/2)]};
  const roofs=[];scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-underside')roofs.push(o)});
  let seamSamples=0,brightSeamPixels=0,ridgeSamples=0,ridgeLeaks=0,maxRidgeError=0;
  for(let z=7.9;z<10;z+=.008){
   const hit=new Raycaster(new Vector3(5.67,6,z),new Vector3(0,1,0)).intersectObjects(roofs,false)[0];if(!hit)continue;
   const [x,y]=pixel(new Vector3(5.65963,hit.point.y,z));
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const px=x+dx,py=y+dy;if(px<0||py<0||px>=width||py>=height)continue;
    const i=(py*width+px)*4;seamSamples++;if(Math.max(lit[i],lit[i+1],lit[i+2])>180)brightSeamPixels++;
   }
  }
  // The closed ridge receives no direct sun. Removing the sun supplies the
  // same cached indirect lighting as a reference, without hiding the roof.
  for(let y=Math.floor(height*.55);y<height*.95;y++)for(let x=Math.floor(width*.48);x<width*.53;x++){
   const i=(y*width+x)*4,error=Math.max(lit[i]-dark[i],lit[i+1]-dark[i+1],lit[i+2]-dark[i+2]);
   ridgeSamples++;if(error>3)ridgeLeaks++;maxRidgeError=Math.max(maxRidgeError,error);
  }
  saved.field.dispose();return {png,bindings,seamSamples,brightSeamPixels,ridgeSamples,ridgeLeaks,maxRidgeError,glError:context.getError()};
 })()`)
 writeFileSync(`${output}/loft.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png
 writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(result)
 assert.ok(result.seamSamples>2000)
 assert.ok(result.bindings>0,'saved GI uniforms must be bound to the displayed materials')
 assert.equal(result.brightSeamPixels,0,'interior gable must not receive outdoor sky along the roof mask texels')
 assert.ok(result.ridgeLeaks<result.ridgeSamples*.005,'filtered sunlight must not leak across the closed ridge')
 assert.equal(result.glError,0)
 assert.deepEqual(browser.errors,[])
 console.log('PASS Springfield saved GI gable and ridge seams')
}finally{browser.close()}
