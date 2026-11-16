import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/lightingRefinementWorker.html'})
 const result=await b.evaluate(`(async()=>{
  const {WebGLRenderer,PerspectiveCamera,Scene,Mesh,BoxGeometry,MeshStandardMaterial,DataTexture,DataUtils,Vector3}=await import('/tests/browser/rendererTestModules.ts')
  const {snapshotLocalSunPreview}=await import('/src/localSunPreviewSnapshot.ts')
  const {installNonBlockingShaderDiagnostics}=await import('/src/shaderDiagnostics.ts')
  const gl=new WebGLRenderer(),scene=new Scene(),camera=new PerspectiveCamera(),texture=new DataTexture(new Uint8Array([128,64,255,255]),1,1)
  texture.needsUpdate=true;const mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial({map:texture}));scene.add(mesh)
  scene.userData.getIndirectUniforms=()=>({hdSkyRadianceBase:{value:new Vector3(.65,.72,.82)},hdSkyMode:{value:0}})
  installNonBlockingShaderDiagnostics(gl)
  const compile=gl.compileAsync.bind(gl),render=gl.render.bind(gl);let prepared=false,draws=0,unexpectedDraws=0,cancel=false
  gl.compileAsync=(...args)=>compile(...args).then(value=>{prepared=true;return value})
  gl.render=(...args)=>{draws++;if(!prepared)unexpectedDraws++;return render(...args)}
  try{
   const output=await snapshotLocalSunPreview({gl,scene,camera},()=>false,()=>{},true)
   const rgb=Array.from(output.data.textures[0].pixels,DataUtils.fromHalfFloat),normalDraws=draws
   gl.compileAsync=(...args)=>compile(...args).then(value=>{cancel=true;return value})
   let cancelled=false;try{await snapshotLocalSunPreview({gl,scene,camera},()=>cancel,()=>{},true)}catch(e){cancelled=String(e).includes('cancelled')}
   return{rgb,prepared,unexpectedDraws,normalDraws,cancelled,drawsAfterCancel:draws-normalDraws}
  }finally{texture.dispose();mesh.material.dispose();mesh.geometry.dispose();gl.dispose()}
 })()`)
 assert.equal(result.prepared,true);assert.equal(result.unexpectedDraws,0);assert.equal(result.normalDraws,1)
 assert.ok(Math.abs(result.rgb[0]-128/255)<.001,JSON.stringify(result));assert.equal(result.rgb[2],1)
 assert.equal(result.cancelled,true);assert.equal(result.drawsAfterCancel,0)
 assert.deepEqual(b.errors,[]);console.log(JSON.stringify(result))
}finally{b.close()}
