import { build, preview } from 'vite'
import { existsSync, readdirSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [mode='reference',folder='tmp/selection-recovery/production-reference',port='5250']=process.argv.slice(2),out=resolve(folder)
const paths=['src/App.tsx','src/components/ThreeDView.tsx','src/components/SceneRenderer.tsx','src/components/ModelSelectionHighlight.tsx','src/importedModelBatching.ts','src/viewportSelection.ts','src/shaderWarmupState.ts','src/shaderWarmup.ts',...(mode==='floor-reference'?['src/components/FloorplanCanvas.tsx']:[])]
function instrument(path,source){
 source=source.replaceAll('\r\n','\n')
 const replace=(from,to)=>{if(!source.includes(from))throw Error('Diagnostic anchor missing in '+path+': '+from.slice(0,60));source=source.replace(from,to)}
 const log=(event,data)=>`Reflect.get(globalThis,'selectionAudit')?.event('${event}',${data});`
 if(path==='src/App.tsx'){
  const anchor=source.match(/const selectModelFromThreeD = \([^\n]+\) => \{/)[0]
  const floor=anchor.includes('floorId:')?'floorId':'floors.find(f=>f.models.some(m=>m.id===modelId))?.id'
  replace(anchor,`${anchor}${log('app.selection.request',`{modelId,floorId:${floor},sceneRevision,project:projectLoadRevision}`)} `)
 }
 if(path==='src/components/ThreeDView.tsx'){
  replace('modelUrls.forEach((sourceUrl) => {',`${log('preloader.models', '{urls:[...modelUrls]}')} modelUrls.forEach((sourceUrl) => {`)
  replace('const uncachedRequests = [...textureRequests.values()].filter(',`${log('preloader.textures', '{missing:[...textureRequests.values()].map(r=>({key:r.textureCacheKey,entries:r.entriesToLoad})),inFlight:[...textureRequests.values()].filter(r=>surfaceTexturePromiseCache.has(r.textureCacheKey)).map(r=>r.textureCacheKey)}')} const uncachedRequests = [...textureRequests.values()].filter(`)
  replace('active = state.active\n      const pending = active', `active = state.active\n ${log('loader.pending', '{active,item:state.item,loaded:state.loaded,total:state.total}')} const pending = active`)
  replace('const handlePointerDown = (event: PointerEvent) => {',`const handlePointerDown = (event: PointerEvent) => {${log('picker.pointerdown','{eventAt:event.timeStamp,active,transforming:isTransformingRef.current,button:event.button}')} `)
  replace('const pickGesture = pickGestureRef.current',`${log('picker.pointerup','{eventAt:event.timeStamp,active,transforming:isTransformingRef.current,gesture:!!pickGestureRef.current}')} const pickGesture = pickGestureRef.current`)
  replace('const colorPickedTarget = performColorPick({',`const pickStarted=performance.now();${log('pick.start','{eventAt:event.timeStamp}')} const colorPickedTarget = performColorPick({`)
  replace('if (!pickedTarget) {\n        emitEngineActivity({',`${log('pick.result',"{ms:performance.now()-pickStarted,targetKind:pickedTarget?.kind,modelId:pickedTarget?.kind==='model'?pickedTarget.modelId:undefined,surface:pickedTarget?.kind==='surface'?pickedTarget.surface:undefined}")} if (!pickedTarget) {\n        emitEngineActivity({`)
 }
 if(path==='src/shaderWarmupState.ts'){
  replace('export function requestShaderWarmup(scene: Object3D) {',`export function requestShaderWarmup(scene: Object3D) {${log('warmup.request',"{project:scene.userData.projectGeneration,generation:shaderWarmupGeneration(scene),stack:new Error().stack?.split('\\n').slice(1,9)}")} `)
  replace(source.match(/export function failShaderWarmup\([^\n]+\) \{/)[0],`${source.match(/export function failShaderWarmup\([^\n]+\) \{/)[0]}${log('warmup.failure',"{project:scene.userData.projectGeneration,generation,generationStale:generation!==shaderWarmupGeneration(scene),cancelled:typeof cancelled==='undefined'?undefined:cancelled,name:error instanceof Error?error.name:typeof error,message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined}")} `)
 }
 return source
}
if(mode!=='serve'){
 if(existsSync(out)&&readdirSync(out).length)throw Error('Choose a fresh evidence directory')
 mkdirSync(out,{recursive:true})
 const sources=new Map(paths.map(path=>[resolve(path).replaceAll('\\','/'),path]))
 await build({plugins:[{name:'bounded-selection-diagnostics',enforce:'pre',load(id){const path=sources.get(id.split('?')[0]);if(path){const file=mode==='reference'?resolve('tmp/selection-recovery/before-source',path.split('/').at(-1)):mode==='floor-reference'?resolve('tmp/selection-cross-floor/before-source',path.split('/').at(-1)):resolve(path);return instrument(path,readFileSync(file,'utf8'))}}}],build:{outDir:out,emptyOutDir:false,minify:false,sourcemap:true,rollupOptions:{input:{app:resolve('index.html'),selection:resolve('tests/browser/selectionRecovery.html')}}}})
 for(const name of ['colin_house_v2.json','springfield_14.json'])copyFileSync(name,resolve(out,name))
}
if(mode!=='verify'){const server=await preview({build:{outDir:out},preview:{host:'127.0.0.1',port:Number(port),strictPort:true}});server.printUrls()}
