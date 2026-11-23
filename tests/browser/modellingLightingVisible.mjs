import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const fixture=process.argv[2]??'lighting-test.json',suffix=process.argv[3]??''
const includePortal=process.argv.includes('--include-portal')
const out=`tmp/modelling-lighting-visible${suffix}`;mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={};let clip
const state=()=>b.evaluate(`(()=>{const s=window.perfScene?.();if(!s)return null;const u=s.scene.userData.getIndirectUniforms?.(),lights=[];s.scene.traverse(o=>{if(o.isLight)lights.push({type:o.type,role:o.userData.houseDesignerRole,intensity:o.intensity,color:o.color?.toArray()})});return {model:s.scene.userData.modellingLighting,ambient:s.scene.userData.ambientFillBudget,failure:s.scene.userData.shaderWarmupFailure,floors:u?.hdGIFloorCount?.value,giEnabled:u?.hdGIEnabled.value,weight:u?.hdFastWeight.value,ready:u?.hdFastReady.value,fill:u?.hdGIIndoorFill.value,feature:u?.hdFastFeature.value,position:s.camera.position.toArray(),probe:s.scene.userData.indirectLighting?.state,lights,programs:s.gl.info.programs.length}})()`)
async function wait(e,ms=240000){const end=Date.now()+ms;let log=Date.now()+10000;while(!await b.evaluate(e)){if(b.errors.length)throw Error(b.errors.join('\n'));if(Date.now()>log){console.log('Waiting',JSON.stringify(await state()));log=Date.now()+10000}if(Date.now()>end)throw Error('Timed out '+e+' '+JSON.stringify(await state()));await new Promise(r=>setTimeout(r,250))}}
async function shot(name){const data=Buffer.from((await b.call('Page.captureScreenshot',{format:'png',clip})).data,'base64');writeFileSync(`${out}/${name}.png`,data);return data}
async function change(expression){await b.evaluate(`(()=>{const s=perfScene(),u=s.scene.userData.getIndirectUniforms();${expression};s.scene.userData.liveLightRevision=(s.scene.userData.liveLightRevision??0)+1;s.invalidate()})()`);await new Promise(r=>setTimeout(r,500))}
async function diff(a,b){const pa=await sharp(a).removeAlpha().raw().toBuffer(),pb=await sharp(b).removeAlpha().raw().toBuffer();let total=0,changed=0,max=0;for(let i=0;i<pa.length;i++){const d=Math.abs(pa[i]-pb[i]);total+=d;max=Math.max(max,d);if(d>3)changed++}return {meanChannelDifference:total/pa.length,fractionOver3:changed/pa.length,max}}
try{
await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`${projectFileInputFixtureSource}window.confirm=()=>true;window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch(${JSON.stringify('/'+fixture)})).json();if(!${includePortal})for(const f of p.floors)f.models=f.models.filter(m=>!m.modelId.startsWith('portal-model-'));return new File([JSON.stringify(p)],${JSON.stringify(fixture)})}}];`})
await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingModel=modelling'})
await wait(`!!window.perfScene?.()&&!!document.querySelector('[aria-label="Project menu"]')`)
await b.evaluate(`(()=>{window.giShaderFailures=[];const s=perfScene(),previous=s.gl.debug.onShaderError;s.gl.debug.onShaderError=(gl,program,vertex,fragment)=>{const source=gl.getShaderSource(fragment)||'';window.giShaderFailures.push({log:gl.getProgramInfoLog(program),defines:source.split('\\n').filter(line=>/^\\s*#define (HD_|NUM_|USE_)/.test(line)),samplers:source.split('\\n').filter(line=>line.includes('sampler')),materials:(()=>{const result=[];s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){const props=s.gl.properties.get(m);if([...props.programs?.values()||[]].some(p=>p.program===program))result.push({role:o.userData.houseDesignerRole,name:o.name,type:m.type,id:m.id})}});return result})()});previous?.(gl,program,vertex,fragment)}})()`)
await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Load')`)
await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Load').click()`)
await wait(`window.perfScene?.()?.scene.userData.modellingLighting?.state==='ready'&&!window.perfScene?.()?.scene.userData.shaderWarmupPending`,360000)
await new Promise(r=>setTimeout(r,1500))
clip=await b.evaluate(`(()=>{const r=perfScene().gl.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
report.ready=await state();console.log('Ready',JSON.stringify(report.ready))
report.programs=await b.evaluate(`(()=>{const s=perfScene(),gl=s.gl.getContext(),samplerTypes=[gl.SAMPLER_2D,gl.SAMPLER_3D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW,gl.SAMPLER_CUBE_SHADOW,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_2D_ARRAY_SHADOW,gl.INT_SAMPLER_2D,gl.UNSIGNED_INT_SAMPLER_2D];return s.gl.info.programs.map(p=>{const source=gl.getShaderSource(p.fragmentShader)||'',samplers=[];for(let i=0,n=gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS);i<n;i++){const u=gl.getActiveUniform(p.program,i);if(samplerTypes.includes(u.type))samplers.push({name:u.name,size:u.size})}return {id:p.id,native:/#define HD_GI_NATIVE_CAPTURE/.test(source),direct:/#define HD_GI_DIRECT_CAPTURE/.test(source),samplerCount:samplers.reduce((n,u)=>n+u.size,0),samplers}})})()`)
const on=await shot('build-on')
await change('u.hdFastWeight.value=0')
report.off=await state();const off=await shot('build-off');report.buildDifference=await diff(on,off)
await change('u.hdFastWeight.value=1;u.hdGIIndoorFill.value=0;s.scene.traverse(o=>{if(o.isAmbientLight||o.isHemisphereLight){o.userData.savedIntensity=o.intensity;o.intensity=0}})')
const noFill=await shot('no-fill-on');report.noFillState=await state()
await change('u.hdFastWeight.value=0')
const noFillOff=await shot('no-fill-off');report.noFillDifference=await diff(noFill,noFillOff)
report.errors=b.errors
}catch(error){report.error=String(error);report.final=await state();report.shaderFailures=await b.evaluate('window.giShaderFailures');report.errors=b.errors;try{await shot('failure')}catch{}console.error(error)}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));b.close()}
