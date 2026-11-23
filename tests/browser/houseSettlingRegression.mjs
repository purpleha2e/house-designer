import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/houseDirectFixture.html' })
  await b.wait('window.directLab?.stats().frames>3')
  const result = await b.evaluate(`(async()=>{
    const l=directLab;l.setPaused(true);
    const {DataTexture,FloatType,RGBAFormat,DataUtils}=await import('/node_modules/three/build/three.module.js');
    const width=l.data.width,height=l.data.height,p=new Float32Array(width*height*4),n=new Float32Array(p.length),light=new Float32Array(p.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4,value=(x<8?.2:.9)+(Math.floor(x/2)%2?-.1:.1);
      p.set([x,0,y,1],at);n.set([0,x<8?-1:1,0,1],at);light.set([value,value,value,1],at);
    }
    const textures=[p,n,light].map(data=>{const t=new DataTexture(data,width,height,RGBAFormat,FloatType);t.needsUpdate=true;return t});
    l.uniforms.receivers.value=textures[0];l.uniforms.normals.value=textures[1];
    const run=async adaptive=>{l.uniforms.filterFootprint.value=adaptive;l.uniforms.filterSource.value=textures[2];l.uniforms.filterDirection.value.set(1,0);l.renderPass(l.filterMaterial,l.scratch,[0]);l.uniforms.filterSource.value=l.scratch.texture;l.uniforms.filterDirection.value.set(0,1);l.renderPass(l.filterMaterial,l.filtered,[0]);const pixels=new Uint16Array(1024);await l.renderer.readRenderTargetPixelsAsync(l.filtered,0,0,16,16,pixels);return [...pixels].map(DataUtils.fromHalfFloat)};
    const before=await run(0),after=await run(1);let oldError=0,newError=0,mean=0,maxFloorChange=0,maxBoundary=0;
    for(let y=2;y<14;y++)for(let x=0;x<16;x++){const at=(y*16+x)*4;if(x<8){oldError+=(before[at]-.2)**2;newError+=(after[at]-.2)**2;mean+=after[at];maxBoundary=Math.max(maxBoundary,after[at]);}else maxFloorChange=Math.max(maxFloorChange,Math.abs(after[at]-before[at]));}
    textures.forEach(t=>t.dispose());return {rmsRatio:Math.sqrt(newError/oldError),mean:mean/96,maxFloorChange,maxBoundary};
  })()`)
  assert.ok(result.rmsRatio < .65, 'A coarse ceiling grid must receive effective smoothing')
  assert.ok(Math.abs(result.mean - .2) < .01, 'Smoothing must preserve the light level')
  assert.equal(result.maxFloorChange, 0, 'Upward-facing floor reconstruction must remain unchanged')
  assert.ok(result.maxBoundary < .31, 'A differently oriented bright surface must not bleed into the ceiling')
  assert.deepEqual(b.errors, [])
  console.log(JSON.stringify(result))
} finally { b.close() }
