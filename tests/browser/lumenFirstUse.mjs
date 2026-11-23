import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'

// Isolate driver first-use latency from model preparation and from shading
// a full window. Each fence completes before the next named draw is submitted.
const browser=await lightingBrowser(),origin=process.env.LUMEN_ORIGIN??'http://127.0.0.1:5188'
try{
  await browser.call('Page.navigate',{url:origin+'/tests/browser/lumenLifecycle.js'})
  await browser.wait('document.readyState==="complete"')
  const rows=await browser.evaluate(`(async()=>{
    const {LumenViewportPass}=await import('/src/lumenViewportPass.ts')
    const {WebGLRenderer,WebGLRenderTarget,PerspectiveCamera,DepthTexture,HalfFloatType,Vector3}=await import('/node_modules/three/build/three.module.js')
    const renderer=new WebGLRenderer(),gl=renderer.getContext(),pass=new LumenViewportPass(new PerspectiveCamera())
    const input=new WebGLRenderTarget(16,16,{type:HalfFloatType,depthTexture:new DepthTexture(16,16)}),output=new WebGLRenderTarget(16,16,{type:HalfFloatType})
    const fence=async()=>{const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();try{while(gl.clientWaitSync(sync,0,0)===gl.TIMEOUT_EXPIRED)await new Promise(r=>setTimeout(r,4))}finally{gl.deleteSync(sync)}}
    const rows=[]
    try{
      const cells=new Uint32Array([1]),positions=new Float32Array(1024),normals=positions.slice(),albedo=positions.slice();normals[1]=1;albedo.fill(.5)
      pass.upload({count:1,width:256,height:1,dimensions:[1,1,1],origin:[0,0,0],spacing:.12,cells,positions,normals,albedo,boundsLo:new Uint8Array(1024),boundsHi:new Uint8Array(1024).fill(255)})
      pass.setSize(16,16);pass.setDepthTexture(input.depthTexture);pass.setDaylight([],new Vector3(1,1,1),new Vector3(),false)
      renderer.setRenderTarget(input);renderer.clear();renderer.setRenderTarget(null)
      const u=pass.displayMaterial.uniforms;u.displayColour.value=input.texture;u.skyVisibility.value=pass.skyAtlas.texture
      const stages=[[pass.skyPass,pass.skyAtlas],[pass.surfaceBouncePass,pass.surfaceBounceAtlases[0]],[pass.trace,pass.bounce],[pass.resolve,pass.resolved],[pass,output]]
      for(const [stage,target] of stages){
        renderer.setRenderTarget(target);const at=performance.now();await renderer.compileAsync(stage.scene,stage.camera);rows.push({program:stage.fullscreenMaterial.name,compileMs:performance.now()-at})
      }
      await fence()
      for(let i=0;i<2;i++)for(const [stage,target] of stages){
        renderer.setRenderTarget(target);const at=performance.now();renderer.render(stage.scene,stage.camera);const submitMs=performance.now()-at;await fence();rows.push({program:stage.fullscreenMaterial.name,repeat:i,submitMs,fencedMs:performance.now()-at})
        const error=gl.getError();if(error!==gl.NO_ERROR)throw Error(stage.fullscreenMaterial.name+' WebGL error '+error)
      }
      return rows
    }finally{pass.dispose();input.dispose();output.dispose();renderer.dispose();renderer.forceContextLoss()}
  })()`)
  assert.deepEqual(browser.errors,[])
  if(!process.argv.includes('--check-only'))await writeFile(new URL('../../docs/lumen-gi/room-review/'+(process.argv[2]??'first-use')+'.json',import.meta.url),JSON.stringify(rows,null,2))
  console.log(rows)
}finally{browser.close()}
