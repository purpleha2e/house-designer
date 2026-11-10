import { AdditiveBlending, Box3, BufferAttribute, BufferGeometry, Color, DataTexture, DepthTexture, DirectionalLight,
  GLSL3, HalfFloatType, Matrix4, Mesh, MeshStandardMaterial, NearestFilter, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, PointLight, Points, RedFormat, RGBAFormat, Scene, ShaderMaterial, SpotLight,
  UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { createIndirectCaptureScene } from './indirectCaptureScene.ts'
import { snapshotFastGIGeometry } from './fastGIGeometry.ts'
import { roomLightCaptureUniform } from './roomLightShader.ts'
import { applyIndirectLightingShader, type IndirectUniforms } from './indirectLightingShader.ts'
import { fastGIRayCount, fastBounceFragment, fastGatherFragment, fastPackFragment, fastSplatFragment, fastSplatVertex, fastStateFragment } from './fastGIPasses.ts'
import { fastFilterFragment, fastFilterSigma } from './fastGIFilter.ts'
import type { IndirectFloor } from './indirectLighting.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, roomProbePoint } from './indirectLighting.ts'
import { configureFastGIShadows } from './fastGIShadows.ts'
import { compileShaderWarmup, prepareShaderWarmupSnapshot } from './shaderWarmup.ts'
import type { DaylightSkyMode } from './daylightSky.ts'
import { createLightingPerformance } from './lightingPerformance.ts'

export type FastGIMode = 'combined' | 'fast' | 'probe'
export type FastGIOptions = { enabled: boolean; hybrid: boolean; mode: FastGIMode; viewsPerFrame: number; bounces?: number; frameBudgetMs?: number }
export type FastGIStats = { state: string; revision: number; views: number; captureSubmitMs: number;
  reconstructionSubmitMs: number; propagationSubmitMs: number; preparationMs: number; geometryMs: number;
  firstVisibleMs?: number; publishedAt?:number; gpuMs?: number; gpuCaptureMs?:number; gpuReconstructionMs?:number; gpuPropagationMs?:number;
  gpuBatches:number; bytes: number; probeProgress: number; bounces?:number; targetBounces?:number; error?: string }

/** Stable room coordinates prevent camera movement from changing the lighting.
 * The prototype covers one room and its boundary; other rooms retain probes. */
export function fastGIRoom(floors: IndirectFloor[], camera: Vector3) {
  const rooms = new Map<string, { floor: IndirectFloor; room: IndirectFloor['rooms'][number] }>()
  for (const floor of floors) for (const room of floor.rooms) {
    const key = `${floor.id}:${room.signature}`
    // Doorway patches carry their owning room's signature. They must not
    // replace that room with a tiny lighting volume when entering through a door.
    if (!rooms.has(key)) rooms.set(key, { floor, room })
  }
  const candidates = [...rooms.values()]
  const selected = candidates.find(({ floor, room }) => camera.y >= floor.elevation && camera.y <= floor.elevation + floor.height &&
    pointIsInsideRoomPolygon({ x: camera.x, y: camera.z }, room.polygon)) ?? candidates.reduce<typeof candidates[number] | undefined>((best, next) => {
      const centre = (entry: typeof next) => new Vector3(entry.room.polygon.reduce((s,p)=>s+p.x,0)/entry.room.polygon.length,
        entry.floor.elevation+1.2,entry.room.polygon.reduce((s,p)=>s+p.y,0)/entry.room.polygon.length)
      return !best || centre(next).distanceToSquared(camera)<centre(best).distanceToSquared(camera) ? next : best
    }, undefined)
  if (!selected) return null
  const { floor, room } = selected, polygon = room.polygon
  const min = new Vector3(Math.min(...polygon.map(p=>p.x))-.15, floor.elevation-.15, Math.min(...polygon.map(p=>p.y))-.15)
  const max = new Vector3(Math.max(...polygon.map(p=>p.x))+.15, floor.elevation+floor.height+.15, Math.max(...polygon.map(p=>p.y))+.15)
  const p = roomProbePoint(polygon, { x:(min.x+max.x)*.5,y:(min.z+max.z)*.5 })
  return { key: `${floor.id}:${room.signature}`, bounds: new Box3(min,max), anchor:new Vector3(p.x, floor.elevation+Math.min(1.2,floor.height*.5),p.y), polygon }
}

const axes = [new Vector3(1,0,0),new Vector3(-1,0,0),new Vector3(0,1,0),new Vector3(0,-1,0),new Vector3(0,0,1),new Vector3(0,0,-1)]
const quadVertex = 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}'

/** GPU-only depth reconstruction, surface accumulation and two diffuse bounces.
 * The optional worker supplies occupancy only; captures remain the light source. */
export function createFastGI(renderer: WebGLRenderer, source: Scene, uniforms: IndirectUniforms, n=32, size=64) {
  const context = renderer.getContext() as WebGL2RenderingContext
  if (!renderer.extensions.has('EXT_color_buffer_float') || context.getParameter(context.MAX_DRAW_BUFFERS)<4 ||
    renderer.capabilities.logarithmicDepthBuffer || renderer.capabilities.reversedDepthBuffer) return null
  const target = (width:number,height:number,count=1,depthBuffer=false) => new WebGLRenderTarget(width,height,{
    count,depthBuffer,type:HalfFloatType,format:RGBAFormat,minFilter:NearestFilter,magFilter:NearestFilter,generateMipmaps:false })
  const captures=target(size*4,size*3,4,true), surfaces=target(n*n,n*6,3), coefficients=target(n*n,n,4), bounced=target(n*n,n*6)
  captures.depthTexture=new DepthTexture(size*4,size*3)
  const states=[target(n*n,n),target(n*n,n)], lighting=[target(n*n,n*4),target(n*n,n*4)]
  const filtered=target(n*n,n*4)
  const geometryData=new Uint8Array(n**3), geometryTexture=new DataTexture(geometryData,n*n,n,RedFormat,UnsignedByteType)
  geometryTexture.needsUpdate=true
  const inverseVP=Array.from({length:12},()=>new Matrix4()), vp=inverseVP.map(()=>new Matrix4()), eyes=axes.concat(axes).map(()=>new Vector3())
  const minimum=new Vector3(), volumeSize=new Vector3(), anchor=new Vector3(), bounds=new Box3()
  const perspectiveCamera=new PerspectiveCamera(90,1,.03,50),verticalCamera=new OrthographicCamera(-1,1,1,-1,.03,50)
  let captureCamera:PerspectiveCamera|OrthographicCamera=perspectiveCamera
  const shared={ n:{value:n},volumeMin:{value:minimum},volumeSize:{value:volumeSize},inverseVP:{value:inverseVP},vp:{value:vp},eyes:{value:eyes} }
  const splatMaterial=new ShaderMaterial({glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
    transparent:true,blending:AdditiveBlending,uniforms:{...shared,captureDepth:{value:captures.depthTexture},captureSize:{value:size},
      captureNormal:{value:captures.textures[2]},captureRadiance:{value:captures.texture},captureResponse:{value:captures.textures[3]}},vertexShader:fastSplatVertex,fragmentShader:fastSplatFragment})
  const pointsGeometry=new BufferGeometry();pointsGeometry.setAttribute('position',new BufferAttribute(new Float32Array(12*size*size*3),3))
  const splatScene=new Scene(),points=new Points(pointsGeometry,splatMaterial);points.frustumCulled=false;splatScene.add(points)
  const stateMaterial=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{...shared,
    surfaceRadiance:{value:surfaces.texture},geometryOccupancy:{value:geometryTexture},captureDepth:{value:captures.depthTexture},hybrid:{value:1}},
    vertexShader:quadVertex,fragmentShader:fastStateFragment})
  const rays=Array.from({length:fastGIRayCount},(_,i)=>{const y=1-2*(i+.5)/fastGIRayCount,a=i*2.3999632297,r=Math.sqrt(1-y*y);return new Vector3(Math.cos(a)*r,y,Math.sin(a)*r)})
  const gatherMaterial=new ShaderMaterial({glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{...shared,
    surfaceRadiance:{value:surfaces.texture},surfaceNormal:{value:surfaces.textures[1]},occupancy:{value:states[0].texture},rays:{value:rays},skyRadiance:{value:new Vector3()},hdSkyMode:{value:1},hdSkySunIrradiance:{value:new Vector3()}},
    vertexShader:quadVertex,fragmentShader:fastGatherFragment})
  const packMaterial=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{
    ...shared,occupancy:{value:states[0].texture},
    c0:{value:coefficients.textures[0]},cx:{value:coefficients.textures[1]},cy:{value:coefficients.textures[2]},cz:{value:coefficients.textures[3]},
    outputSize:{value:new Vector2(n*n,n*4)}},vertexShader:quadVertex,fragmentShader:fastPackFragment})
  const bounceMaterial=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{...shared,
    surfaceRadiance:{value:surfaces.texture},surfaceNormal:{value:surfaces.textures[1]},surfaceResponse:{value:surfaces.textures[2]},light:{value:lighting[0].texture}},
    vertexShader:quadVertex,fragmentShader:fastBounceFragment})
  const filterMaterial=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{...shared,
    light:{value:lighting[0].texture},axis:{value:new Vector3()},sigma:{value:fastFilterSigma},outputSize:{value:new Vector2(n*n,n*4)}},
    vertexShader:quadVertex,fragmentShader:fastFilterFragment})
  const geometry=new PlaneGeometry(2,2),quad=new Mesh(geometry,stateMaterial),quadScene=new Scene(),quadCamera=new OrthographicCamera(-1,1,1,-1,0,1)
  quadScene.add(quad)
  let proxies:ReturnType<typeof createIndirectCaptureScene>|null=null,worker:Worker|null=null,version=0,view=0,bank=0,started=0,disposed=false
  let previousProxies:ReturnType<typeof createIndirectCaptureScene>|null=null
  let shadowPrograms:Awaited<ReturnType<typeof prepareShaderWarmupSnapshot>>
  const preparingScenes=new Set<ReturnType<typeof createIndirectCaptureScene>>()
  let activePreparations=0
  const release=()=>{[captures,surfaces,coefficients,bounced,filtered,...states,...lighting].forEach(t=>t.dispose());geometryTexture.dispose()
    ;[splatMaterial,stateMaterial,gatherMaterial,packMaterial,bounceMaterial,filterMaterial].forEach(m=>m.dispose());pointsGeometry.dispose();geometry.dispose()}
  let stage='idle', compiled=false,geometryReady=false,requestedHybrid=true,requestedBounds:Box3|null=null
  let roomPolygon:{x:number;y:number}[]|undefined
  let bounceStrength=1
  let captureLightIndices:{point:Float32Array;spot:Float32Array}|null=null
  const timerPending:{query:WebGLQuery;stage:string}[]=[]
  const timerExtension=context.getExtension('EXT_disjoint_timer_query_webgl2')
  const performanceProfile=createLightingPerformance(renderer)
  let bounceCount=0
  const stats:FastGIStats={state:'idle',revision:0,views:0,captureSubmitMs:0,reconstructionSubmitMs:0,propagationSubmitMs:0,preparationMs:0,
    geometryMs:0,gpuBatches:0,bytes:(size*size*12*(4*8+4)+n**3*(6*4*8+4*8+2*8+3*4*8)+n**3),probeProgress:0}
  const restoreState = <T>(action:()=>T):T => {
    const rt=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),xr=renderer.xr.enabled
    const auto=renderer.autoClear,clear=renderer.getClearColor(new Color()),alpha=renderer.getClearAlpha(),viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest()
    const shadowEnabled=renderer.shadowMap.enabled,shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate,capture=uniforms.hdGICapture.value,diffuseCapture=uniforms.hdGIDiffuseCapture.value,room=roomLightCaptureUniform.value
    const pointIndices=uniforms.hdGIPointIndices.value.slice(),spotIndices=uniforms.hdGISpotIndices.value.slice()
    const renderStats={...renderer.info.render}
    try { renderer.xr.enabled=false;renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.autoClear=false;
      renderer.setClearColor(0,0);uniforms.hdGICapture.value=1;uniforms.hdGIDiffuseCapture.value=1;roomLightCaptureUniform.value=1
      if(captureLightIndices){uniforms.hdGIPointIndices.value.set(captureLightIndices.point);uniforms.hdGISpotIndices.value.set(captureLightIndices.spot)}
      return action()
    } finally { uniforms.hdGICapture.value=capture;uniforms.hdGIDiffuseCapture.value=diffuseCapture;roomLightCaptureUniform.value=room;renderer.autoClear=auto;renderer.xr.enabled=xr
      renderer.shadowMap.enabled=shadowEnabled;renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;renderer.setClearColor(clear,alpha)
      uniforms.hdGIPointIndices.value.set(pointIndices);uniforms.hdGISpotIndices.value.set(spotIndices)
      renderer.setRenderTarget(rt,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);Object.assign(renderer.info.render,renderStats) }
  }
  const draw=(material:ShaderMaterial,destination:WebGLRenderTarget)=>{quad.material=material;renderer.setRenderTarget(destination);renderer.setViewport(0,0,destination.width,destination.height);renderer.setScissorTest(false);renderer.render(quadScene,quadCamera)}
  const filter=()=>{
    // Neither target is the previous published bank. Keep the old room field
    // intact while all three directional sweeps prepare its replacement.
    for(const [axis,input,output] of [[axes[0],lighting[bank],filtered],[axes[2],filtered,lighting[bank]],
      [axes[4],lighting[bank],filtered],[new Vector3(),filtered,lighting[bank]]] as const){
      filterMaterial.uniforms.axis.value.copy(axis);filterMaterial.uniforms.light.value=input.texture;draw(filterMaterial,output)
    }
  }
  const fail=(error:unknown)=>{stage='error';stats.state='error';stats.error=String(error);worker?.terminate();worker=null;uniforms.hdFastReady.value=0}
  const configureCamera=(index:number)=>{
    const axis=axes[Math.floor(index/2)],reverse=index%2===1
    captureCamera=reverse&&Math.abs(axis.y)>.5?verticalCamera:perspectiveCamera
    captureCamera.position.copy(anchor);captureCamera.up.set(0,Math.abs(axis.y)>.5?0:1,Math.abs(axis.y)>.5?1:0)
    if(reverse) {
      // Known room boundaries avoid selecting centre-pixel furniture and keep
      // camera placement bounded even for windows, missing hits and grazing rays.
      let distance=Infinity
      if(Math.abs(axis.y)>.5) distance=((axis.y>0?bounds.max.y-.15:bounds.min.y+.15)-anchor.y)/axis.y
      else if(roomPolygon) for(let i=0;i<roomPolygon.length;i++) {
        const a=roomPolygon[i],b=roomPolygon[(i+1)%roomPolygon.length]
        const alongX=Math.abs(axis.x)>.5,origin=alongX?anchor.z:anchor.x,first=alongX?a.y:a.x,last=alongX?b.y:b.x
        if(Math.abs(last-first)<.00001)continue
        const t=(origin-first)/(last-first)
        if(t<0||t>1)continue
        const crossing=alongX?a.x+(b.x-a.x)*t:a.y+(b.y-a.y)*t
        const d=(crossing-(alongX?anchor.x:anchor.z))/(alongX?axis.x:axis.z)
        if(d>.05)distance=Math.min(distance,d)
      }
      if(!Number.isFinite(distance))distance=Math.min(...[0,1,2].filter(a=>axis.getComponent(a)!==0).map(a=>
        ((axis.getComponent(a)>0?bounds.max:bounds.min).getComponent(a)-anchor.getComponent(a))/axis.getComponent(a)))
      captureCamera.position.copy(anchor).addScaledVector(axis,distance-Math.max(.06,volumeSize.getComponent(Math.floor(index/4))/n*.4))
      if(captureCamera===verticalCamera) {
        const centre=bounds.getCenter(new Vector3());captureCamera.position.x=centre.x;captureCamera.position.z=centre.z
        verticalCamera.left=-volumeSize.x*.5;verticalCamera.right=volumeSize.x*.5
        verticalCamera.top=volumeSize.z*.5;verticalCamera.bottom=-volumeSize.z*.5
        captureCamera.lookAt(captureCamera.position.clone().addScaledVector(axis,-1))
      } else captureCamera.lookAt(anchor)
    } else captureCamera.lookAt(anchor.clone().add(axis))
    if(captureCamera instanceof PerspectiveCamera)captureCamera.fov=reverse?110:90
    captureCamera.far=volumeSize.length()*2;captureCamera.updateProjectionMatrix();captureCamera.updateMatrixWorld(true)
    vp[index].multiplyMatrices(captureCamera.projectionMatrix,captureCamera.matrixWorldInverse);inverseVP[index].copy(vp[index]).invert();eyes[index].copy(captureCamera.position)
  }
  const cancel=(retain=false)=>{version++;worker?.terminate();worker=null;stage='idle';
    if(proxies&&!preparingScenes.has(proxies)) {
      previousProxies?.dispose();previousProxies=retain?proxies:null
      if(!retain)proxies.dispose()
    }
    proxies=null
    timerPending.forEach(item=>context.deleteQuery(item.query));timerPending.length=0 }
  return {
    stats,captures,surfaces,states,lighting,performance:performanceProfile,
    request(room:{bounds:Box3;anchor:Vector3;polygon?:{x:number;y:number}[]},hybrid:boolean,daylight=false,daylightBounceStrength=1,skyMode:DaylightSkyMode='clear') {
      cancel(true);const id=version;started=performance.now();requestedBounds=room.bounds.clone();bounds.copy(room.bounds);minimum.copy(bounds.min);bounds.getSize(volumeSize);anchor.copy(room.anchor)
      requestedHybrid=hybrid;geometryReady=!hybrid;view=0;bank=1-bank;stage='preparing';compiled=false
      roomPolygon=room.polygon
      bounceStrength=daylightBounceStrength
      bounceCount=0;performanceProfile.begin('Room GPU preview')
      gatherMaterial.uniforms.hdSkyMode.value=skyMode==='overcast'?2:1
      const sun=source.children.find(object=>object instanceof DirectionalLight && object.userData.houseDesignerRole==='sun-light') as DirectionalLight|undefined
      const sunDirection=sun?new Vector3().subVectors(sun.position,sun.target.position).normalize():new Vector3()
      gatherMaterial.uniforms.hdSkySunIrradiance.value.set(sun?.color.r??0,sun?.color.g??0,sun?.color.b??0).multiplyScalar(daylight&&sun?sun.intensity*Math.max(0,sunDirection.y)*daylightBounceStrength:0)
      gatherMaterial.uniforms.skyRadiance.value.set(.65,.72,.82).multiplyScalar(daylight?daylightBounceStrength:0)
      Object.assign(stats,{state:stage,revision:id,views:0,captureSubmitMs:0,reconstructionSubmitMs:0,propagationSubmitMs:0,preparationMs:0,geometryMs:0,
        firstVisibleMs:undefined,publishedAt:undefined,gpuMs:undefined,gpuCaptureMs:undefined,gpuReconstructionMs:undefined,gpuPropagationMs:undefined,gpuBatches:0,bounces:0,error:undefined})
      // Geometry and render preparation are independent. Neither waits for probes.
      if(hybrid) {
        worker=new Worker(new URL('./fastGI.worker.ts',import.meta.url),{type:'module'})
        worker.onmessage=event=>{if(disposed||id!==version)return; if(event.data.error){fail(event.data.error);return}
          geometryData.set(event.data.data);geometryTexture.needsUpdate=true;geometryReady=true;stats.geometryMs=event.data.ms;worker?.terminate();worker=null}
        worker.onerror=event=>{if(id===version)fail(event.message)}
        worker.postMessage({id,parts:snapshotFastGIGeometry(source,bounds),min:minimum.toArray(),size:volumeSize.toArray(),n})
      }
      // Existing proxies preserve authored material hooks, instancing and shared
      // sun shadows. Cooperative construction is used by the runtime component.
      return id
    },
    async prepare(id:number, prepare:()=>Promise<ReturnType<typeof createIndirectCaptureScene>|undefined>,localLights:readonly (PointLight|SpotLight)[] = []) {
      let prepared:ReturnType<typeof createIndirectCaptureScene>|undefined
      activePreparations++
      try {
        const next=await performanceProfile.wait('capture proxy construction',prepare());if(!next)return
        if(disposed||id!==version){next.dispose();return}
        prepared=next;preparingScenes.add(next)
        proxies=next
        captureLightIndices=null
        if(localLights.length){
          // Realtime light slots can be culled or have zero intensity. Use the
          // same authored capture lights as probes, cloned into this scene.
          proxies.scene.children.filter(object=>object instanceof PointLight||object instanceof SpotLight).forEach(object=>object.removeFromParent())
          captureLightIndices={point:new Float32Array(INDIRECT_MAX_LOCAL_LIGHTS).fill(-1),spot:new Float32Array(INDIRECT_MAX_LOCAL_LIGHTS).fill(-1)}
          let point=0,spot=0
          localLights.forEach((original,index)=>{
            if(original.intensity<=0)return
            const light=original.clone(false);proxies!.scene.add(light)
            if(light instanceof SpotLight){light.target=original instanceof SpotLight?original.target.clone():light.target;proxies!.scene.add(light.target)}
            const indices=light instanceof SpotLight?captureLightIndices!.spot:captureLightIndices!.point,slot=light instanceof SpotLight?spot++:point++
            if(slot<indices.length)indices[slot]=INDIRECT_ATLAS_SIZE**2-INDIRECT_MAX_LOCAL_LIGHTS+index
          })
          proxies.scene.updateMatrixWorld(true)
        }
        proxies.scene.traverse(object=>{if(object instanceof DirectionalLight&&object.userData.houseDesignerRole==='sun-light')object.intensity*=bounceStrength})
        const furniture:Box3[]=[]
        source.traverse(object=>{if(object.name.startsWith('model-transform-')||/model/i.test(object.name)&&object instanceof Mesh)
          furniture.push(new Box3().setFromObject(object).expandByScalar(.12))})
        if(furniture.some(box=>box.containsPoint(anchor))) {
          const centre=anchor.clone()
          outer:for(const distance of [.8,1.6,2.4])for(const direction of axes.filter(axis=>axis.y===0)) {
            const candidate=centre.clone().addScaledVector(direction,distance)
            if(bounds.containsPoint(candidate)&&(!roomPolygon||pointIsInsideRoomPolygon({x:candidate.x,y:candidate.z},roomPolygon))&&
              !furniture.some(box=>box.containsPoint(candidate))){anchor.copy(candidate);break outer}
          }
        }
        const materials=new Set<MeshStandardMaterial>()
        proxies.scene.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])
          if(material instanceof MeshStandardMaterial)materials.add(material)})
        materials.forEach(material=>applyIndirectLightingShader(material,uniforms))
        proxies.enableSurfaceRadianceCapture(false,true);proxies.scene.background=null
        const shadows=configureFastGIShadows(proxies.scene)
        const dispose=next.dispose
        next.dispose=()=>{shadows.dispose();dispose()}
        configureCamera(0)
        // Compile every variant without changing the display's capture uniforms.
        quad.material=stateMaterial
        const compile=(scene:Scene,camera:PerspectiveCamera|OrthographicCamera,target:WebGLRenderTarget)=>performanceProfile.wait('shader compilation',restoreState(()=>{renderer.setRenderTarget(target);return renderer.compileAsync(scene,camera)}))
        if(shadows.lights.length) {
          const cancelled=()=>disposed||id!==version
          const snapshot=await prepareShaderWarmupSnapshot(next.scene,{fadeWalls:false,fadeRoofs:false,shadows:true},cancelled)
          if(!snapshot)return
          let retained=false
          try {
            const ready=await compileShaderWarmup(renderer,snapshot.root,captureCamera,next.scene,{cancelled,
              compile:batch=>restoreState(()=>{renderer.setRenderTarget(captures);return renderer.compileAsync(batch,captureCamera,next.scene)})})
            if(!ready)return
            // A normal render establishes Three's render state before its
            // internal shadow pass. Keep the throwaway colour pass tiny.
            restoreState(()=>{
              renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(captures)
              renderer.setViewport(0,0,1,1);renderer.setScissor(0,0,1,1);renderer.setScissorTest(true)
              renderer.render(next.scene,captureCamera)
            })
            shadows.lights.forEach(light=>{light.shadow.autoUpdate=false;light.shadow.needsUpdate=false})
            shadowPrograms?.dispose();shadowPrograms=snapshot;retained=true
          } finally { if(!retained)snapshot.dispose() }
        }
        await compile(next.scene,captureCamera,captures)
        if(disposed||id!==version)return
        await compile(splatScene,quadCamera,surfaces)
        for(const [material,destination] of [[stateMaterial,states[bank]],[gatherMaterial,coefficients],[packMaterial,lighting[bank]],[bounceMaterial,bounced],[filterMaterial,filtered]] as const) {
          if(disposed||id!==version)return
          quad.material=material;await compile(quadScene,quadCamera,destination)
        }
        if(disposed||id!==version)return
        stats.preparationMs=performance.now()-started;compiled=true;stage='capture'
        previousProxies?.dispose();previousProxies=null
        restoreState(()=>{captures.scissorTest=false;renderer.setRenderTarget(captures);renderer.clear();renderer.setRenderTarget(surfaces);renderer.clear()})
      } catch(error){if(id===version)fail(error)}
      finally {if(prepared){preparingScenes.delete(prepared);if(disposed||id!==version)prepared.dispose()}
        activePreparations--;if(disposed&&activePreparations===0)release()}
    },
    step(options:FastGIOptions,probeReady:boolean,delta:number) {
      performanceProfile.poll()
      const budget=Math.max(.5,Math.min(8,options.frameBudgetMs??4)),targetBounces=Math.max(2,Math.min(8,options.bounces??2))
      stats.targetBounces=targetBounces
      performanceProfile.phase(stage)
      stats.state=stage
      while(timerPending.length&&context.getQueryParameter(timerPending[0].query,context.QUERY_RESULT_AVAILABLE)) {
        const item=timerPending.shift()!
        if(!context.getParameter(timerExtension!.GPU_DISJOINT_EXT)) {
          const ms=context.getQueryParameter(item.query,context.QUERY_RESULT)/1e6
          const key=item.stage==='capture'?'gpuCaptureMs':item.stage==='reconstruct'?'gpuReconstructionMs':'gpuPropagationMs'
          stats[key]=(stats[key]??0)+ms;stats.gpuMs=(stats.gpuMs??0)+ms;stats.gpuBatches++
        }
        context.deleteQuery(item.query)
      }
      if(stage==='ready') {
        const desired=options.mode==='fast'?1:options.mode==='probe'?0:probeReady?0:1
        const previousWeight=uniforms.hdFastWeight.value
        const speed=desired>previousWeight?8:2
        uniforms.hdFastWeight.value+=Math.sign(desired-uniforms.hdFastWeight.value)*Math.min(Math.abs(desired-uniforms.hdFastWeight.value),delta*speed)
        if(previousWeight!==uniforms.hdFastWeight.value)source.userData.liveLightRevision=(source.userData.liveLightRevision??0)+1
        return uniforms.hdFastWeight.value!==desired
      }
      if(!compiled||!['capture','reconstruct','gather','bounce'].includes(stage))return stage==='preparing'
      if(stage==='reconstruct'&&!geometryReady)return true
      const frameStart=performance.now()
      try {restoreState(()=>{
        const submit=(phase:string,action:()=>void)=>{
          const query=timerExtension&&!context.getQuery(timerExtension.TIME_ELAPSED_EXT,context.CURRENT_QUERY)?context.createQuery():null
          if(query)context.beginQuery(timerExtension!.TIME_ELAPSED_EXT,query)
          try {performanceProfile.renders(phase,action)} finally {if(query){context.endQuery(timerExtension!.TIME_ELAPSED_EXT);timerPending.push({query,stage:phase})}}
        }
        if(stage==='capture') submit('capture',()=>{
          const at=performance.now()
          for(let count=0;count<Math.max(1,Math.min(6,options.viewsPerFrame))&&view<12&&(count===0||performance.now()-at<budget);count++,view++) {
            configureCamera(view);renderer.setRenderTarget(captures);renderer.setViewport((view%4)*size,Math.floor(view/4)*size,size,size)
            renderer.setScissor((view%4)*size,Math.floor(view/4)*size,size,size);renderer.setScissorTest(true);renderer.render(proxies!.scene,captureCamera)
          }
          stats.views=view;stats.captureSubmitMs+=performance.now()-at;if(view===12)stage='reconstruct'
        })
        if(stage==='reconstruct'&&geometryReady&&performance.now()-frameStart<budget) submit('reconstruct',()=>{
          const at=performance.now();renderer.setRenderTarget(surfaces);renderer.setViewport(0,0,n*n,n*6);renderer.setScissorTest(false);renderer.render(splatScene,quadCamera)
          stateMaterial.uniforms.hybrid.value=requestedHybrid?1:0;draw(stateMaterial,states[bank]);stats.reconstructionSubmitMs+=performance.now()-at;stage='gather'
        })
        if(stage==='gather'&&performance.now()-frameStart<budget) submit('gather',()=>{
          const at=performance.now();gatherMaterial.uniforms.surfaceRadiance.value=surfaces.texture;gatherMaterial.uniforms.occupancy.value=states[bank].texture;packMaterial.uniforms.occupancy.value=states[bank].texture;draw(gatherMaterial,coefficients);draw(packMaterial,lighting[bank]);filter()
          stats.propagationSubmitMs=performance.now()-at
          bounceCount=1;stats.bounces=1
          stage='bounce'
        })
        else if(stage==='bounce') submit('gather',()=>{
          const at=performance.now();bounceMaterial.uniforms.light.value=lighting[bank].texture;draw(bounceMaterial,bounced)
          gatherMaterial.uniforms.surfaceRadiance.value=bounced.texture;draw(gatherMaterial,coefficients);draw(packMaterial,lighting[bank]);filter()
          stats.propagationSubmitMs+=performance.now()-at
          stats.bounces=++bounceCount
          if(bounceCount<targetBounces)return
          uniforms.hdFastLight.value=lighting[bank].texture
          const wasReady=uniforms.hdFastReady.value>.5
          uniforms.hdFastMin.value.copy(requestedBounds!.min);requestedBounds!.getSize(uniforms.hdFastSize.value);uniforms.hdFastN.value=n;uniforms.hdFastReady.value=1
          uniforms.hdFastWeight.value=options.mode==='probe'?0:options.mode==='fast'||!wasReady?1:Math.max(.2,uniforms.hdFastWeight.value)
          stats.publishedAt=performance.now();stats.firstVisibleMs=stats.publishedAt-started;stage='ready';performanceProfile.memory(stats.bytes);performanceProfile.finish()
          source.userData.liveLightRevision=(source.userData.liveLightRevision??0)+1
        })
      })} catch(error){fail(error)}
      stats.state=stage;return stage!=='ready'
    },
    get bounds(){return requestedBounds},get bank(){return bank},get captureScene(){return proxies?.scene},
    dispose(){disposed=true;cancel();performanceProfile.dispose();previousProxies?.dispose();previousProxies=null;shadowPrograms?.dispose();shadowPrograms=undefined;uniforms.hdFastReady.value=0;if(activePreparations===0)release()},
  }
}

