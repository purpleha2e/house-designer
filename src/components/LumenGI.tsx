import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DirectionalLight, Matrix4,Vector3, type Mesh, type Texture } from 'three'
import { DiffuseSnapshotChanged, snapshotReferenceScene } from '../diffuseSceneSnapshot'
import type { ReferenceTexture } from '../diffuseSceneMaterials'
import { surfaceMaterialsById } from '../materials/materialCatalog'
import type { AtlasRow, SurfaceAtlas } from '../lumenSurfaceCache'
import { LumenViewportPass } from '../lumenViewportPass'
import type { LumenOpening } from '../lumenSkyVisibility'
import { createLumenDetailClient } from '../lumenDetailClient'
import { readViewportTransparency } from '../ambientOcclusionResources'
import { measureLumenGlazing } from '../lumenGlazing'
import { recordViewportLightingWork } from '../viewportLightingWork'

export type LumenTraceMethod = 'patches' | 'sdf'
type Options = { enabled:boolean; blocked:boolean; revision:string; diagnostic:number; openings:LumenOpening[]; trace:LumenTraceMethod; compactCenter?:number[] }
export function LumenOptions(options:Options) {
  const {scene,invalidate} = useThree()
  useLayoutEffect(() => {
    scene.userData.lumenOptions = options
    scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0)+1
    invalidate()
    return () => { delete scene.userData.lumenOptions }
  },[scene,invalidate,options.enabled,options.blocked,options.revision,options.diagnostic,options.openings,options.trace,options.compactCenter])
  return null
}

const category = (mesh:Mesh) => {
  if(mesh.userData.houseDesignerRole==='ground-plane')return 3
  if (mesh.userData.houseDesignerRole !== 'room-floor-finish') return 0
  const key = mesh.userData.floorSurfaceBatchKey
  if (typeof key !== 'string') return 1
  const id = JSON.parse(key)[2]
  const material = surfaceMaterialsById.get(id)
  return /carpet/i.test([id,material?.productName,material?.category].join(' ')) ? 2 : 1
}

type Reply = { id:number; atlas?:SurfaceAtlas; rows?:AtlasRow[]; center?:number[];cacheHit?:boolean;retainedBytes?:number; rebuilt:boolean; bvhBuilt:boolean; bvhMs:number; accounting?:unknown; buildMs:number; conflicts:{normal:number;material:number;separatedPlanes:number}; error?:string;
  lighting?:{ radiance:Float32Array; ms:number; lit:number; litCarpet:number } }

/** Keep the pass mounted so editor startup prepares its finite shader set.
 * Only the selected backend starts a worker or requests a scene snapshot. */
export function LumenViewport() {
  const {scene,gl,camera,invalidate} = useThree()
  const pass = useMemo(() => new LumenViewportPass(camera),[camera])
  const frame = useRef<() => void>(() => {})
  const mountedPass = useRef<LumenViewportPass | null>(null)
  useEffect(() => {
    mountedPass.current = pass
    pass.readTransparency=()=>readViewportTransparency(scene)
    const status = { state:'inactive', detail:'', surfaces:0, geometryBuilds:0, relights:0, litCarpet:0, lightingSource:'',
      bvhBuilds:0,bvhMs:0,atlasBytes:0,snapshotMs:0,originalTriangles:0,lightingTriangles:0,reducedRanges:0,accounting:undefined as unknown,frames:0, sunFrames:0, lastSunFrameAt:0, daylightReady:false,bounceReady:false,refining:false, cpuMs:0, gpuMs:null as number|null, invalidation:'',
      conflicts:{normal:0,material:0,separatedPlanes:0}, skyGpuPeakMs:0,buildMs:0, lightMs:0, visibleMs:0, unsupported:{} as Record<string,number>,
      cacheProfile:pass.cacheProfile,cacheHits:0,cacheMisses:0,retainedBytes:0,snapshotPhases:null as null|{extractionMs:number;simplificationMs:number;snapshotGeometryMs:number;materialsMs:number},
      trace:'patches' as LumenTraceMethod, distanceBuildMs:0, distanceBytes:0 }
    scene.userData.lumenGI = status
    const inspect=(x:number,y:number)=>{
      if(!pass.enabled)return Promise.reject(new Error('Wait for the surface cache'))
      const inspection=pass.inspect(x,y);redraw();return inspection
    }
    scene.userData.inspectLumenPixel=inspect
    const pick=(event:PointerEvent)=>{
      if(!event.altKey || !pass.enabled)return
      const r=gl.domElement.getBoundingClientRect()
      void inspect((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height)
        .then(sample=>{scene.userData.lumenPixel=sample}).catch(()=>{})
    }
    gl.domElement.addEventListener('pointerdown',pick)
    let continueLighting=false
    pass.onPresent=sunChanged=>{
      status.frames++
      if(sunChanged){status.sunFrames++;status.lastSunFrameAt=performance.now()}
      status.daylightReady=pass.skyReady
      status.bounceReady=pass.bounceReady
      status.skyGpuPeakMs=pass.skyGpuPeakMs
      status.refining=pass.refining
      if(!pass.skyReady || pass.refining){continueLighting=true;invalidate()}
    }
    pass.onTiming=(cpu,gpu)=>{status.cpuMs=cpu;if(gpu!==null)status.gpuMs=gpu}
    const images = new WeakMap<Texture,{key:string;value:ReferenceTexture}>()
    const detail=createLumenDetailClient()
    const flags=new URLSearchParams(location.search)
    const requestedBudget=Number(flags.get('lumenCacheBudget'))
    if(Number.isFinite(requestedBudget) && requestedBudget>0)pass.cacheBudgetMs=Math.max(1,Math.min(4,requestedBudget))
    let worker:Worker | undefined, busy=false, epoch=0, loaded='', publishedSun=-1, center:number[]=[]
    let sun:DirectionalLight | undefined
    let glazedRevision='',glazedOpenings:LumenOpening[]=[],sourceOpenings:LumenOpening[]|undefined
    const sunPoint=new Vector3(), target=new Vector3()
    const lastDirection=new Vector3(),energy=new Vector3(),lastEnergy=new Vector3()
    let lastGPUSun=false,sunVersion=0
    const redraw=() => { scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1; invalidate() }
    const stop=() => {
      epoch++; worker?.terminate(); worker=undefined; detail.dispose(); busy=false; loaded=''; publishedSun=-1; center=[]
      pass.cancelUpload()
      pass.releaseCache()
      pass.setFloorMeshes([])
      status.state='inactive'
      status.daylightReady=false;status.bounceReady=false;status.refining=false
      status.trace='patches';status.distanceBuildMs=0;status.distanceBytes=0
    }
    const fail=(reason:unknown) => {
      stop(); status.state='error'; status.detail=reason instanceof Error?reason.message:String(reason); redraw()
    }
    frame.current=() => {
      if(continueLighting){continueLighting=false;scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1}
      const options=scene.userData.lumenOptions as Options | undefined
      if (!options?.enabled) { if(status.state!=='inactive') stop(); return }
      if (status.state==='error') return
      const revision=options.revision+':'+(scene.userData.viewportMaterialRevision??0)
      if(!options.blocked && scene.userData.progressiveStartup?.phase==='full' && pass.stepUpload(gl))invalidate()
      const fixedCenter=options.compactCenter
      const needsRegion=fixedCenter ? fixedCenter.some((value,i)=>value!==center[i]) :
        !center.length || Math.abs(camera.position.x-center[0])>3 || Math.abs(camera.position.y-center[1])>1.9 || Math.abs(camera.position.z-center[2])>3
      const needsScene=loaded!==revision || needsRegion
      const distanceField=options.trace==='sdf' && !flags.has('lumenVolumeCache')
      const needsDistance=distanceField && !pass.hasDistanceField
      if (loaded!==revision || options.blocked) pass.enabled=false
      if (options.blocked || scene.userData.progressiveStartup?.phase!=='full') return
      if(!sun?.parent) sun=scene.getObjectByProperty('type','DirectionalLight') as DirectionalLight | undefined
      if(sun?.userData.houseDesignerRole!=='sun-light') scene.traverse(o=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')sun=o})
      if(!sun) return
      sun.getWorldPosition(sunPoint).sub(sun.target.getWorldPosition(target)).normalize()
      energy.set(sun.color.r,sun.color.g,sun.color.b).multiplyScalar(sun.intensity)
      const gpuSun=!!(sun.castShadow && sun.shadow.map?.depthTexture)
      status.lightingSource=gpuSun?'Sun shadow map':'Triangle visibility'
      if(lastGPUSun!==gpuSun || !lastDirection.equals(sunPoint) || !lastEnergy.equals(energy)){
        lastGPUSun=gpuSun;lastDirection.copy(sunPoint);lastEnergy.copy(energy);sunVersion++
      }
      const sunKey=sunVersion
      const uniform=scene.userData.getIndirectUniforms?.()
      if(uniform){
        if(revision!==glazedRevision || options.openings!==sourceOpenings){
          glazedOpenings=measureLumenGlazing(scene,options.openings);glazedRevision=revision;sourceOpenings=options.openings
        }
        pass.setDaylight(glazedOpenings,uniform.hdSkyRadianceBase.value,uniform.hdSkyDisplaySunIrradiance.value,uniform.hdSkyMode.value>1.5,fixedCenter)
      }
      pass.sun=gpuSun ? sun : undefined
      status.trace=pass.setDistanceTracing(distanceField)?'sdf':'patches'
      pass.displayMaterial.uniforms.diagnostic.value=options.diagnostic
      pass.enabled=loaded===revision && (gpuSun || publishedSun===sunKey)
      if(!needsScene && gpuSun && !busy && publishedSun!==sunKey){
        publishedSun=sunKey; status.relights++;status.state='ready'; status.invalidation='Sunlight'; redraw()
        return
      }
      if(busy || (!needsScene && !needsDistance && publishedSun===sunKey)) return
      const direction=sunPoint.toArray(),irradiance=energy.toArray()
      const nextCenter=needsRegion ? fixedCenter??camera.position.toArray() : center
      const ticket=++epoch, started=performance.now()
      busy=true; status.state=needsScene || needsDistance?'building':'relighting'
      status.invalidation=needsRegion?'Camera region':needsScene?'Geometry or finish':needsDistance?'Preparing distance field':'Sunlight'
      if(!worker) {
        recordViewportLightingWork(scene, 'lumenWorkers')
        worker=new Worker(new URL('../lumenSurfaceCache.worker.ts',import.meta.url),{type:'module'})
      }
      worker.onerror=e=>{if(ticket===epoch)fail(e.message)}
      worker.onmessage=({data}:MessageEvent<Reply>)=>{
        if(ticket!==epoch || data.id!==ticket) return
        if(data.error){ fail(data.error); return }
        const current=scene.userData.lumenOptions as Options | undefined
        if(!current?.enabled || current.blocked || revision!==current.revision+':'+(scene.userData.viewportMaterialRevision??0)) {
          busy=false;loaded='';redraw();return
        }
        const publish=()=>{
          busy=false
          const active=scene.userData.lumenOptions as Options|undefined
          if(!active?.enabled || revision!==active.revision+':'+(scene.userData.viewportMaterialRevision??0)){loaded='';redraw();return}
          const a=data.atlas
          if(a){
            status.surfaces=a.count;center=data.center??nextCenter;loaded=revision
            status.distanceBuildMs=a.distanceField?.buildMs??0
            status.distanceBytes=a.distanceField?.values.byteLength??0
            status.atlasBytes=a.cells.byteLength+a.positions.byteLength+a.normals.byteLength+a.albedo.byteLength+(a.boundsLo?.byteLength??0)+(a.boundsHi?.byteLength??0)+(gpuSun?56:72)*a.width*a.height+status.distanceBytes
          }
          if(data.rows){pass.updateRows(data.rows);loaded=revision;status.invalidation=`Finish · ${data.rows.length} atlas rows`}
          else if(data.rebuilt)status.invalidation=needsRegion?'Camera region':'Geometry'
          if(data.lighting)pass.relight(data.lighting.radiance)
          if(data.rebuilt)status.geometryBuilds++
          if(data.cacheHit && needsRegion)status.cacheHits++
          if(data.rebuilt)status.cacheMisses++
          status.retainedBytes=data.retainedBytes??0
          if(data.bvhBuilt)status.bvhBuilds++
          status.bvhMs=data.bvhMs;status.accounting=data.accounting;status.conflicts=data.conflicts;status.buildMs=data.buildMs; status.lightMs=data.lighting?.ms??0; status.litCarpet=data.lighting?.litCarpet??0
          status.relights++; status.visibleMs=performance.now()-started
          publishedSun=sunKey; status.state='ready'; redraw()
        }
        if(data.atlas){pass.queueAtlas(data.atlas,publish);invalidate()}
        else publish()
      }
      const aligned=!flags.has('lumenVolumeCache')
      if(!needsScene && !needsDistance){worker.postMessage({kind:'sun',id:ticket,direction,irradiance});return}
      const viewProjection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements
      if(loaded===revision){worker.postMessage({kind:'region',id:ticket,center:nextCenter,direction,irradiance,gpuSun,aligned,viewProjection,distanceField});return}
      const cancelled=()=>ticket!==epoch || !scene.userData.lumenOptions?.enabled || scene.userData.lumenOptions.revision!==options.revision
      // Classify each mesh once even when its source contains many triangles.
      const tags=new WeakMap<Mesh,number>()
      const floorMeshes:Mesh[]=[]
      void snapshotReferenceScene({scene,gl},mesh=>tags.get(mesh)??0,{imageReader:pass.imageReader,textureLimit:64,diffusePbr:true,cancelled,
        interactive:{textureCache:images,detailIndices:flags.has('lumenFullDetail')?undefined:detail.indices,visitMesh:mesh=>{
          const kind=category(mesh);tags.set(mesh,kind)
          if(kind===1)floorMeshes.push(mesh)
        }}}).then(snapshot=>{
        if(cancelled()){if(ticket===epoch){busy=false;redraw()}return}
        pass.setFloorMeshes(floorMeshes)
        status.unsupported=snapshot.unsupported
        status.snapshotMs=snapshot.snapshotMs;status.originalTriangles=snapshot.originalTriangles;status.lightingTriangles=snapshot.triangles;status.reducedRanges=snapshot.reducedRanges
        status.snapshotPhases=snapshot.phases
        const data=snapshot.data
        // Cached image pixels remain owned by the UI for later material edits.
        const transfer=[data.positions,data.uvs,data.materialIndices,data.sourceCategories,data.sourceIds,data.metalnessUVs,data.emissionUVs]
          .flatMap(a=>a?[a.buffer as ArrayBuffer]:[])
        worker!.postMessage({kind:'scene',id:ticket,data,center:nextCenter,direction,irradiance,gpuSun,aligned,viewProjection,distanceField,fullAtlas:!loaded || needsDistance},transfer)
      }).catch(error=>{
        if(ticket!==epoch)return
        busy=false
        if(cancelled() || error instanceof DiffuseSnapshotChanged){redraw();return}
        fail(error)
      })
    }
    return () => {
      gl.domElement.removeEventListener('pointerdown',pick);delete scene.userData.inspectLumenPixel;delete scene.userData.lumenPixel
      frame.current=()=>{}; pass.onPresent=undefined; pass.onTiming=undefined;pass.readTransparency=undefined; stop(); delete scene.userData.lumenGI
      mountedPass.current = null
      queueMicrotask(() => { if (mountedPass.current !== pass) pass.dispose() })
    }
  },[scene,gl,camera,invalidate,pass])
  useFrame(()=>frame.current())
  return <primitive object={pass} dispose={null} />
}
