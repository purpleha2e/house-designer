import test from 'node:test'
import assert from 'node:assert/strict'
import {PerspectiveCamera, Scene, WebGLRenderTarget, type WebGLRenderer} from 'three'
import {installRendererHealth, recordRendererFrame, rendererHealthHistory} from '../src/rendererHealth.ts'

test('health records context events and disposal without querying GL during frames',async()=>{
 const canvas=Object.assign(new EventTarget(),{width:1280,height:720,isConnected:true})
 let queries=0,restores=0,disposed=0,target:WebGLRenderTarget|null=null
 const gl={isContextLost:()=>false,getError:()=>{queries++;return 0},checkFramebufferStatus:()=>{queries++;return 36053},getParameter:()=>new Int32Array([0,0,1280,720]),isEnabled:()=>false,FRAMEBUFFER:36160,FRAMEBUFFER_COMPLETE:36053}
 const renderer={domElement:canvas,getContext:()=>gl,getRenderTarget:()=>target,info:{memory:{textures:2,geometries:3},programs:[]},
  render:()=>{},compileAsync:async()=>{},setRenderTarget:(t:WebGLRenderTarget|null)=>{target=t},initRenderTarget:()=>{},shadowMap:{needsUpdate:false},dispose:()=>{disposed++}} as unknown as WebGLRenderer
 const scene=new Scene(),camera=new PerspectiveCamera(),health=installRendererHealth(renderer,scene,()=>restores++)
 assert.equal(installRendererHealth(renderer,scene),health)
 recordRendererFrame(renderer,camera);renderer.render(scene,camera)
 assert.equal(queries,0);assert.equal(health.snapshot().renders,1)
 const rt=new WebGLRenderTarget(12,8);renderer.setRenderTarget(rt);assert.equal(health.snapshot().targets.length,1)
 rt.dispose();assert.equal(health.snapshot().targets.length,0)
 renderer.setRenderTarget(rt);assert.equal(health.snapshot().targets.length,1)
 for(let i=0;i<120;i++)canvas.dispatchEvent(new Event('webglcontextlost'))
 canvas.dispatchEvent(new Event('webglcontextrestored'))
 assert.equal(health.snapshot().events.length,100);assert.equal(restores,1);assert.equal(renderer.shadowMap.needsUpdate,true)
 assert.equal(health.snapshot().contextGeneration,121)
 renderer.setRenderTarget(null);health.snapshot(true);assert.equal(queries,2)
 renderer.dispose();renderer.dispose();assert.equal(disposed,1);assert.equal(scene.userData.getRendererHealth,undefined)
 assert.equal(rendererHealthHistory.at(-1)?.events.at(-1)?.type,'disposed')
})
