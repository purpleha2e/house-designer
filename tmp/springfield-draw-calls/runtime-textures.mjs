import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { installSceneEditPreload } from '../../tests/browser/sceneEditTrace.js'
import { writeFileSync } from 'node:fs'
const browser=await lightingBrowser()
try{
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installSceneEditPreload.toString()})()`})
  await browser.call('Page.navigate',{url:'http://127.0.0.1:5183/'})
  await browser.wait(`(()=>{const walk=f=>{if(!f)return; if(f.memoizedProps?.value?.getState?.()?.scene)window.textureStore=f.memoizedProps.value;for(let d=f.dependencies?.firstContext;d;d=d.next)if(d.memoizedValue?.getState?.()?.scene)window.textureStore=d.memoizedValue;walk(f.child);walk(f.sibling)};for(const root of sceneEditTrace.roots.keys())walk(root.current);return window.textureStore?.getState().scene.userData.progressiveStartup?.phase==='full'})()`,300000)
  const report=await browser.evaluate(`(()=>{const s=textureStore.getState(),textures=new Map();s.scene.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])for(const [slot,t]of Object.entries(m))if(t?.isTexture){let row=textures.get(t.uuid);if(!row){const i=t.image??t.source?.data;row={name:t.name,width:i?.width??t.mipmaps?.[0]?.width,height:i?.height??t.mipmaps?.[0]?.height,compressed:!!t.isCompressedTexture,format:t.format,type:t.type,mipmaps:t.mipmaps?.length,generateMipmaps:t.generateMipmaps,minFilter:t.minFilter,anisotropy:t.anisotropy,owners:[]};textures.set(t.uuid,row)}row.owners.push({object:o.name,material:m.name,slot})}});return {textures:[...textures.values()].sort((a,b)=>b.width*b.height-a.width*a.height),gpuTextureObjects:s.gl.info.memory.textures,errors:[]}})()`)
  writeFileSync('tmp/springfield-draw-calls/runtime-textures.json',JSON.stringify({...report,errors:browser.errors},null,2))
  console.log(JSON.stringify({gpuTextureObjects:report.gpuTextureObjects,large:report.textures.filter(t=>t.width>=4096||t.height>=4096),counts:report.textures.reduce((a,t)=>{const k=`${t.width}x${t.height}:${t.compressed?'compressed':'uncompressed'}`;a[k]=(a[k]??0)+1;return a},{})},null,2))
}finally{browser.close()}
