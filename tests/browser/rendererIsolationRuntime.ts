// The exact same runtime is used on either side of the isolation boundary.
// No production Canvas/reconciler, lighting defaults or algorithms are modified.
import * as T from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { compileShaderWarmup, prepareShaderWarmupResources } from '../../src/shaderWarmup'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'
import { installRendererAttributeDefaults } from '../../src/rendererAttributeDefaults'
import environmentSize from '../../src/assets/environments/skyEnvironment.json'
import { isolationNow, type IsolationCommand, type IsolationEvent } from './rendererIsolationProtocol'

type Row = { calls: number; cpuMs: number; maxMs: number }
type Pool = ReturnType<typeof resourcePool>
function resourcePool() {
  const resources = new Set<{ dispose(): void }>(), bitmaps = new Set<ImageBitmap>()
  return {
    own<V extends { dispose(): void }>(value: V) { resources.add(value); return value },
    bitmap(value: ImageBitmap) { bitmaps.add(value); return value },
    dispose() { resources.forEach(value => value.dispose()); resources.clear(); bitmaps.forEach(value => value.close()); bitmaps.clear() },
  }
}
function watchGL(gl: WebGL2RenderingContext, stage: () => string) {
  const totals: Record<string, Row> = {}, spans: { name: string; parameter?:string; stage: string; at: number; ms: number }[] = []
  const live = new Map<string, Set<object>>()
  for (const name of ['getProgramParameter','getActiveUniform','getUniformLocation','createProgram','linkProgram','compileShader','texImage2D','texSubImage2D','texImage3D','texSubImage3D','bufferData']) {
    const original = Reflect.get(gl, name)
    Reflect.set(gl, name, function(...args: unknown[]) {
      const start = isolationNow()
      try { return original.apply(gl, args) } finally {
        const parameter=name==='getProgramParameter'?({[gl.ACTIVE_UNIFORMS]:'ACTIVE_UNIFORMS',[gl.ACTIVE_ATTRIBUTES]:'ACTIVE_ATTRIBUTES',[gl.LINK_STATUS]:'LINK_STATUS',[0x91b1]:'COMPLETION_STATUS_KHR'}[Number(args[1])]??String(args[1])):undefined
        const ms = isolationNow() - start, key = `${stage()}:${name}${parameter?'.'+parameter:''}`, row = totals[key] ??= { calls: 0, cpuMs: 0, maxMs: 0 }
        row.calls++; row.cpuMs += ms; row.maxMs = Math.max(row.maxMs, ms)
        if (ms >= 2 && spans.length < 800) spans.push({ name, parameter, stage: stage(), at: start, ms })
      }
    })
  }
  for (const kind of ['Buffer','Texture','Program','VertexArray','Framebuffer','Renderbuffer']) {
    const set = new Set<object>(); live.set(kind, set)
    for (const action of ['create','delete']) {
      const name = `${action}${kind}`, original = Reflect.get(gl,name)
      Reflect.set(gl,name,function(...args: unknown[]) { const result=original.apply(gl,args); if(action==='create'&&result)set.add(result);else if(args[0])set.delete(args[0] as object);return result })
    }
  }
  return { totals, spans, outstanding: () => Object.fromEntries([...live].map(([key,set])=>[key,set.size])),
    valid:()=>Object.fromEntries([...live].map(([key,set])=>[key,[...set].filter(value=>Reflect.get(gl,`is${key}`).call(gl,value)).length])) }
}
const taskTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function addBox(pool: Pool, scene: T.Scene, size: number[], position: number[], material: T.Material) {
  const mesh = new T.Mesh(pool.own(new T.BoxGeometry(...size as [number,number,number])), material)
  mesh.position.set(...position as [number,number,number]); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh
}
function room(pool: Pool, materials: T.Material[]) {
  const scene = new T.Scene(); scene.background = new T.Color('#aebccc')
  // The same architectural shell in both configurations, with real apertures.
  addBox(pool,scene,[7,.18,6],[0,-.12,0],materials[0])
  addBox(pool,scene,[7,.18,2],[0,2.9,-2],materials[1])
  addBox(pool,scene,[7,2.8,.18],[0,1.4,-3],materials[1])
  addBox(pool,scene,[.18,2.8,6],[-3.5,1.4,0],materials[2])
  addBox(pool,scene,[.18,2.8,2],[3.5,1.4,-2],materials[3])
  addBox(pool,scene,[.18,.7,2],[3.5,.35,0],materials[3])
  addBox(pool,scene,[.18,.5,2],[3.5,2.55,0],materials[3])
  addBox(pool,scene,[.18,2.8,2],[3.5,1.4,2],materials[4])
  addBox(pool,scene,[2.2,1.8,.15],[0,.9,-.8],materials[5])
  addBox(pool,scene,[1.2,.8,.9],[-1.8,.4,.8],materials[6])
  addBox(pool,scene,[1.4,.08,1.1],[1,.85,.5],materials[7])
  addBox(pool,scene,[.035,1.6,1.8],[3.5,1.5,0],materials[8])
  scene.add(new T.HemisphereLight(0xffffff,0x8d9bad,.45))
  const sun=pool.own(new T.DirectionalLight(0xfff3d9,3));sun.position.set(5,7,4);sun.castShadow=true
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;sun.shadow.camera.far=25
  scene.add(sun,sun.target)
  for(const [x,z,color] of [[-2,-1,0xffcf9a],[2,-1,0xc8dcff]] as const){const light=pool.own(new T.PointLight(color,12,8));light.position.set(x,2.2,z);scene.add(light)}
  return scene
}
async function environment(pool: Pool) {
  const buffer=await(await fetch(new URL('../../src/assets/environments/skyEnvironment.bin.gz',import.meta.url))).arrayBuffer(),header=new Uint8Array(buffer,0,2)
  const bytes=header[0]===31&&header[1]===139?await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():buffer
  const texture=pool.own(new T.DataTexture(new Uint16Array(bytes),environmentSize.width,environmentSize.height,T.RGBAFormat,T.HalfFloatType))
  texture.mapping=T.CubeUVReflectionMapping;texture.colorSpace=T.LinearSRGBColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true
  return texture
}
async function enhanced(cancelled:()=>boolean, report:(detail:Record<string,unknown>)=>void, signal:AbortSignal) {
  const pool=resourcePool();let adopted=false
  try {
    const start=isolationNow(),project=await(await fetch('/colin_house_v2.json',{signal})).json()
    if(cancelled())throw Error('Preparation superseded')
    report({stage:'project JSON read/parse',ms:isolationNow()-start})
    const sources=project.materialDefinitions as {productName:string;pbr:Record<string,unknown>}[]
    const maps:Record<string,T.Texture>[]=[];const textureRows=[]
    for(const material of sources){const set:Record<string,T.Texture>={};maps.push(set)
      for(const [slot,key,color] of [['map','baseColorTextureUrl',true],['normalMap','normalTextureUrl',false],['roughnessMap','roughnessTextureUrl',false]] as const){
        const url=material.pbr[key];if(typeof url!=='string')continue
        const at=isolationNow(),bitmap=pool.bitmap(await createImageBitmap(await(await fetch(url,{signal})).blob(),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'}))
        if(cancelled())throw Error('Preparation superseded')
        const texture=pool.own(new T.Texture(bitmap));texture.flipY=false;texture.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(2,2);texture.needsUpdate=true;set[slot]=texture
        textureRows.push({material:material.productName,slot,width:bitmap.width,height:bitmap.height,decodedBytes:bitmap.width*bitmap.height*4,decodeMs:isolationNow()-at})
        await taskTurn()
      }
    }
    report({stage:'image decode complete',textures:textureRows})
    const field=pool.own(createIndirectField([{id:'fixture',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:-3.5,y:-3},{x:3.5,y:-3},{x:3.5,y:3},{x:-3.5,y:3}]}]}],0))
    // Fixed fully initialized display data, not an altered or new GI solver.
    for(const layer of [field.volume,field.floorLayer]){layer.data.fill(0);const bands=field.coefficientCount;for(let z=0;z<layer.n;z++)for(let row=0;row<layer.height;row++)for(let x=0;x<layer.n;x++){const i=((z*layer.height*bands+row)*layer.n+x)*4;layer.data[i]=T.DataUtils.toHalfFloat(.22);layer.data[i+1]=T.DataUtils.toHalfFloat(.25);layer.data[i+2]=T.DataUtils.toHalfFloat(.3);layer.data[i+3]=T.DataUtils.toHalfFloat(1)}}
    field.floorLayer.ready=true;field.volume.maps[0].needsUpdate=true;field.floorLayer.texture.needsUpdate=true
    const gi=createIndirectUniforms(field);gi.hdGIUseVolume.value=1;gi.hdSkyDisplayRadianceBase.value.set(.65,.72,.82)
    const local=createRoomLightShaderUniforms(field.mask);local.enabled.value=0
    const material=(settings:T.MeshStandardMaterialParameters)=>{const value=pool.own(new T.MeshStandardMaterial(settings));applyRoomLightShader(value,local);applyIndirectLightingShader(value,gi);return value}
    const materials=[material({color:0xffffff,...maps[0],roughness:.65}),material({color:0xe4e0d6,roughness:.8}),material({color:0xffffff,...maps[1],roughness:.6}),material({color:0xc3d1da,normalMap:maps[0].normalMap,roughness:.35}),material({color:0xd7a692,roughness:.7}),material({color:0xffffff,map:maps[1].map,roughness:.4}),material({color:0xa4bac5,metalness:.9,roughness:.2,normalMap:maps[0].normalMap}),material({color:0x68737f,metalness:1,roughness:.15}),pool.own(new T.MeshPhysicalMaterial({color:0xd2edfa,roughness:.1,transparent:true,opacity:.27,depthWrite:false,side:T.DoubleSide,forceSinglePass:true}))]
    const scene=room(pool,materials);scene.environment=await environment(pool);scene.environmentIntensity=.55
    const at=isolationNow(),gltf=await new GLTFLoader().loadAsync(new URL('../../src/models/assets/interior_door_closed.glb',import.meta.url).href)
    gltf.scene.traverse(object=>{if(!(object instanceof T.Mesh))return;pool.own(object.geometry);object.castShadow=object.receiveShadow=true;for(const m of Array.isArray(object.material)?object.material:[object.material]){pool.own(m);for(const value of Object.values(m))if(value instanceof T.Texture){pool.own(value);if(value.image instanceof ImageBitmap)pool.bitmap(value.image)}applyRoomLightShader(m,local);applyIndirectLightingShader(m,gi)}})
    gltf.scene.position.set(-2,0,-2.85);gltf.scene.rotation.y=Math.PI/2;scene.add(gltf.scene)
    report({stage:'glTF load/parse',ms:isolationNow()-at})
    if(cancelled())throw Error('Preparation superseded')
    adopted=true
    return {scene,pool,textures:textureRows,field,dispose:()=>pool.dispose()}
  } finally {if(!adopted)pool.dispose()}
}

export async function createIsolationRenderer(canvas: HTMLCanvasElement|OffscreenCanvas,generation:number,emit:(event:IsolationEvent)=>void) {
  let phase='initialise',revision=0,epoch=0,disposed=false,preparing=false,activeJobs=0,controller:AbortController|undefined,cameraCommand={id:0,angle:0,sentAt:0},lastFrame=-Infinity
  const clock=isolationNow,events:Record<string,unknown>[]=[],frameTimes:number[]=[],gpuSamples:number[]=[],fences:{sync:WebGLSync;command:number;at:number}[]=[]
  const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'}) as WebGL2RenderingContext|null
  if(!gl)throw Error('WebGL2 unavailable')
  const native=watchGL(gl,()=>phase),renderer=new T.WebGLRenderer({canvas:canvas as HTMLCanvasElement,context:gl,antialias:true})
  renderer.setSize(840,480,false);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap
  installNonBlockingShaderDiagnostics(renderer);const releaseDefaults=installRendererAttributeDefaults(renderer)
  const audit=Reflect.get(globalThis,'shaderProgramAudit') as {attach(renderer: T.WebGLRenderer, phase:()=>string):void}|undefined
  audit?.attach(renderer,()=>phase)
  const camera=new T.PerspectiveCamera(52,840/480,.05,50)
  const send=(type:string,detail:Record<string,unknown>={})=>emit({type,generation,revision,at:clock(),...detail})
  const makeBasic=()=>{const pool=resourcePool(),materials=Array.from({length:9},(_,i)=>pool.own(new T.MeshStandardMaterial({color:[0x939eac,0xd7d9db,0xc3b39f,0xb8c6d2,0xc4b6ae,0xc5b598,0x8899a8,0x808b97,0xbad8e4][i],roughness:.7})));return{scene:room(pool,materials),dispose:()=>pool.dispose()}}
  let active=makeBasic()
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const queries:WebGLQuery[]=[];let frame=0,raf=0,lastSubmittedCommand=-1
  const report=()=>({phase,preparing,activeJobs,generation,revision,events,native:native.totals,nativeSpans:native.spans,resources:{...renderer.info.memory,programs:renderer.info.programs?.length,outstanding:native.outstanding()},frameTimes,gpuSamples,disposed,contextLost:gl.isContextLost()})
  send('support',{three:T.REVISION,webgl:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),maxSamplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),worker:typeof document==='undefined',workerRaf:typeof requestAnimationFrame==='function',gpuTimer:!!timer})
  const marker=(id:number)=>{renderer.setScissorTest(true);for(let bit=0;bit<12;bit++){renderer.setScissor(bit*8,0,8,8);renderer.setClearColor(id&(1<<bit)?0xffffff:0x000000,1);renderer.clear(true,false,false)}renderer.setScissorTest(false)}
  const render=(at:number)=>{
    if(disposed)return
    raf=requestAnimationFrame(render)
    if(at-lastFrame<1000/30-1)return
    const now=clock();if(frameTimes.length<1800)frameTimes.push(now);lastFrame=at;frame++
    camera.position.set(8*Math.sin(.75+cameraCommand.angle),5.5,8*Math.cos(.75+cameraCommand.angle));camera.lookAt(0,1,0);camera.updateMatrixWorld()
    const query=timer&&queries.length===0&&frame%8===0?gl.createQuery():null
    if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query)
    const start=clock();renderer.render(active.scene,camera);marker(cameraCommand.id)
    if(query){gl.endQuery(timer!.TIME_ELAPSED_EXT);queries.push(query)}
    if(frame===1)send('first-geometry',{submittedAt:clock(),cpuMs:clock()-start})
    if(cameraCommand.id!==lastSubmittedCommand&&fences.length<2){lastSubmittedCommand=cameraCommand.id;const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(sync){gl.flush();fences.push({sync,command:cameraCommand.id,at:clock()})}send('camera-frame',{id:cameraCommand.id,sentAt:cameraCommand.sentAt,submittedAt:clock()})}
    for(let i=fences.length-1;i>=0;i--){const f=fences[i],status=gl.clientWaitSync(f.sync,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED){send('camera-gpu-complete',{id:f.command,submittedAt:f.at});gl.deleteSync(f.sync);fences.splice(i,1)}}
    if(queries.length&&gl.getQueryParameter(queries[0],gl.QUERY_RESULT_AVAILABLE)){const q=queries.shift()!;if(!gl.getParameter(timer!.GPU_DISJOINT_EXT))gpuSamples.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}
  }
  raf=requestAnimationFrame(render)
  const prepare=async()=>{
    if(preparing||activeJobs||disposed){send('busy');return}
    preparing=true;activeJobs++;controller=new AbortController();const signal=controller.signal,version=++epoch,started=clock(),cancelled=()=>disposed||epoch!==version
    let job:Awaited<ReturnType<typeof enhanced>>|undefined,adopted=false
    const stage=(detail:Record<string,unknown>)=>{if(cancelled())return;events.push({at:clock(),...detail});send('stage',detail)}
    try{
      phase='fetch/decode/construct';stage({stage:phase});job=await enhanced(cancelled,stage,signal)
      if(cancelled())return
      phase='shader compilation/reflection';const compileAt=clock();stage({stage:phase})
      const compiled=await compileShaderWarmup(renderer,job.scene,camera,job.scene,{cancelled})
      stage({stage:'shader compilation/reflection complete',ms:clock()-compileAt})
      if(!compiled||cancelled())return
      phase='texture/geometry upload';const uploadAt=clock();stage({stage:phase})
      if(!await prepareShaderWarmupResources(renderer,job.scene,camera,job.scene,true,cancelled)||cancelled())return
      stage({stage:'texture/geometry upload complete',ms:clock()-uploadAt})
      active.dispose();active=job;adopted=true;phase='prepared';send('ready',{totalMs:clock()-started,report:report()})
    }catch(error){if(!cancelled()){phase='failed';send('error',{error:String(error),report:report()})}}
    finally{if(job&&!adopted)job.dispose();activeJobs--;if(epoch===version)preparing=false;send('job-settled',{cancelled:cancelled(),activeJobs})}
  }
  return {command(message:IsolationCommand){
    if(message.type==='init')return
    if(message.type==='replace'){
      if(message.generation<=generation)return
      generation=message.generation;revision=message.revision;epoch++;controller?.abort();preparing=false;const old=active;active=makeBasic();old.dispose();phase='replacement basic';send('replaced');return
    }
    if(message.generation!==generation||message.revision<revision){send('rejected',{message:message.type,obsoleteGeneration:message.generation});return}
    revision=message.revision
    if(message.type==='camera'){cameraCommand=message.command;send('camera-ack',{id:cameraCommand.id,sentAt:cameraCommand.sentAt});return}
    if(message.type==='prepare'){void prepare();return}
    if(message.type==='cancel'){epoch++;controller?.abort();preparing=false;phase='cancelled';send('cancelled',{sentAt:message.sentAt});return}
    if(message.type==='snapshot'){send('snapshot',{report:report()});return}
    if(message.type==='shutdown'){
      epoch++;controller?.abort();disposed=true;cancelAnimationFrame(raf);fences.forEach(f=>gl.deleteSync(f.sync));queries.forEach(q=>gl.deleteQuery(q));active.dispose();releaseDefaults();renderer.dispose();const beforeLoss=report();renderer.forceContextLoss();send('disposed',{report:beforeLoss,afterContextLoss:gl.isContextLost(),validAfterContextLoss:native.valid()})
    }
  },report}
}
