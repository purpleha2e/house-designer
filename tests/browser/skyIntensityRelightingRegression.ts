import {createDaylightSky} from '../../src/daylightSky'
import {requestedIndirectSHOrder,indirectSHCoefficientCount} from '../../src/indirectSH'
import { BoxGeometry, Color, CubeCamera, DataTexture, DirectionalLight, HalfFloatType, LinearSRGBColorSpace,
  Mesh, MeshStandardMaterial, PointLight, RGBAFormat, Scene, SpotLight, WebGLCubeRenderTarget, WebGLRenderer, WebGLRenderTarget, DataUtils,
  type SphericalHarmonics3 } from 'three'
import { prepareIndirectCache } from '../../src/indirectLightingCache'
import { snapshotIndirectGeometry } from '../../src/indirectVisibility'
import { applyIndirectLightingShader, createIndirectUniforms, updateIndirectUniforms } from '../../src/indirectLightingShader'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { createIndirectCaptureScene } from '../../src/indirectCaptureScene'
import { createIndirectSurfaceCache } from '../../src/indirectSurfaceCache'
import { indirectSurfaceLights, indirectSurfaceSun } from '../../src/indirectSurfaceRelighting'
import { createIndirectProbeIntegrator } from '../../src/indirectProbeIntegration'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS } from '../../src/indirectLighting'

const renderer = new WebGLRenderer({ antialias: false }); renderer.setSize(256, 256)
const staticCapture = new URLSearchParams(location.search).has('static')
const dynamicSun = new URLSearchParams(location.search).has('sun')
const skyTest = new URLSearchParams(location.search).has('sky')
const nightSurface = new URLSearchParams(location.search).has('night-surface')
document.body.append(renderer.domElement)
const scene = new Scene(), materials: MeshStandardMaterial[] = []
const add = (size: number[], position: number[], color: string, metalness = 0, roughness = .8) => {
  const material = new MeshStandardMaterial({ color, metalness, roughness })
  const mesh = new Mesh(new BoxGeometry(...size as [number, number, number]), material)
  mesh.position.set(...position as [number, number, number]); scene.add(mesh); materials.push(material)
}
add([4,.1,4], [2,-.05,2], '#ddbb99')
add([.1,2.4,4], [0,1.2,2], '#ee8866'); add([.1,2.4,4], [4,1.2,2], '#88aaff')
add([4,2.4,.1], [2,1.2,0], '#eeeeee'); add([4,2.4,.1], [2,1.2,4], '#eeeeee')
add([4,.1,4], [2,2.45,2], '#eeeeee')
add([.2,2.4,4], [1.5,1.2,2], '#aacc99', .6, .35) // Metallic partition between point lamp and probe.
materials[6].emissive.set('#183308'); materials[6].emissiveIntensity=.15
const emission = new DataTexture(new Uint8Array([255,80,20,255, 100,255,80,255, 80,140,255,255, 255,255,255,255]),2,2)
emission.needsUpdate = true; materials[6].emissiveMap = emission
const sun=new DirectionalLight('#aaccee',.3);sun.position.set(3,8,4);scene.add(sun,sun.target)
if (nightSurface) sun.intensity = 0
sun.userData.houseDesignerRole = 'sun-light'
if (dynamicSun) {
  renderer.shadowMap.enabled = true; sun.castShadow = true; sun.shadow.mapSize.set(512,512)
  Object.assign(sun.shadow.camera, {left:-5,right:5,top:5,bottom:-5,near:.1,far:20});sun.shadow.camera.updateProjectionMatrix()
  scene.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true}})
  materials[5].visible=skyTest // Open roof: moving the sun must change indirect input and partition shadows.
}
const normal = new DataTexture(new Uint8Array([150,110,250,255, 110,150,250,255, 120,145,250,255, 140,120,250,255]),2,2)
normal.needsUpdate = true; materials[0].normalMap = normal
const point = new PointLight('#ffd080', 4, 12, 1.15); point.position.set(1,1.7,1)
const spot = new SpotLight('#80aaff', 6, 10, Math.PI/3, .3, 1.15); spot.position.set(3,2,3); spot.target.position.set(2,0,2)
const lights = [point,spot]
const floors = [{ id:'floor',elevation:0,height:2.4,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}] }]
scene.updateMatrixWorld(true)
const shOrder=requestedIndirectSHOrder(),coefficientCount=indirectSHCoefficientCount(shOrder)
const snapshots = snapshotIndirectGeometry(scene)
const prepared = [prepareIndirectCache(floors, lights.map(l=>l.position.toArray()), snapshots, [], undefined, undefined, undefined, undefined, shOrder)]
const field = prepared[0].field, uniforms = createIndirectUniforms(field)
const triangles = prepared[0].visibility.triangleTexture()
uniforms.hdGITriangles.value = triangles; uniforms.hdGITriangleSize.value.set(triangles.image.width,triangles.image.height)
uniforms.hdGICapture.value = 1
uniforms.hdGIDiffuseCapture.value = 1
if(skyTest){uniforms.hdSkyMode.value=new URLSearchParams(location.search).has('overcast')?2:1;uniforms.hdSkyRadianceBase.value.set(.65,.72,.82);uniforms.hdSkySunIrradiance.value.set(.6,.5,.4)}
const offset = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS
uniforms.hdGIPointIndices.value[0] = offset; uniforms.hdGISpotIndices.value[0] = offset + 1
const roomTexture=new DataTexture(new Uint8Array([0,0,0,255]),1,1);roomTexture.needsUpdate=true
const room = createRoomLightShaderUniforms(roomTexture); room.enabled.value = 0
materials.forEach(m=>{ applyRoomLightShader(m,room); applyIndirectLightingShader(m,uniforms) })
const capture = createIndirectCaptureScene(scene,true)
const combined = createIndirectCaptureScene(scene,true)
if (nightSurface) combined.enableNightSurfaceCapture()
else combined.enableSurfaceRadianceCapture(true)
const size=new URLSearchParams(location.search).has('size16')?16:8, cube=new WebGLCubeRenderTarget(size,{type:HalfFloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,generateMipmaps:false})
const camera=new CubeCamera(.03,80,cube);camera.coordinateSystem=renderer.coordinateSystem;camera.updateCoordinateSystem()
camera.position.set(2,skyTest?3.2:1.2,2);camera.updateMatrixWorld(true)
const integrator=createIndirectProbeIntegrator(size,'cube',[0,1,2,3,4,5],false,shOrder)
const cache=createIndirectSurfaceCache(renderer,[0],size,uniforms,true)!
const sourceSky=createDaylightSky(32),updateSky=()=>{
  if(skyTest){
    sourceSky.update(uniforms.hdSkyMode.value>1.5?'overcast':'clear',uniforms.hdSkyRadianceBase.value.x/.65,uniforms.hdSkySunIrradiance.value)
    capture.scene.background=sourceSky.texture
  }
}
updateSky()
const updateLights=()=>{lights.forEach(l=>l.updateMatrixWorld(true));spot.target.updateMatrixWorld(true)}
const compare=(a:SphericalHarmonics3,b:SphericalHarmonics3)=>{
  let max=0,peak=0;for(let i=0;i<coefficientCount;i++)for(let c=0;c<3;c++){const x=a.coefficients[i].getComponent(c),y=b.coefficients[i].getComponent(c);max=Math.max(max,Math.abs(x-y));peak=Math.max(peak,Math.abs(y))}return{max,peak}
}
try {
  const compileStarted=performance.now()
  await cache.compile()
  const compileMs=performance.now()-compileStarted
  if (dynamicSun) {
    renderer.render(scene,camera.children[0]);renderer.shadowMap.autoUpdate=false
    indirectSurfaceSun(combined.scene)!.intensity=0
  }
  for(const target of [combined.scene,capture.scene]){if(!staticCapture||target===capture.scene)target.add(...lights,spot.target);await renderer.compileAsync(target,camera.children[0]);lights.forEach(l=>target.remove(l));target.remove(spot.target)}
  if(!staticCapture)combined.scene.add(...lights,spot.target)
  updateLights()
  for(let face=0;face<6;face++){
    renderer.autoClear=false;cache.beginFace(0,face,new Color(0,0,0));renderer.render(combined.scene,camera.children[face])
    cache.copyFace(0,face,new Color(0,0,0),cube,true)
  }
  renderer.autoClear=true;combined.scene.remove(...lights,spot.target)
  cache.ready.add(0);cache.recordLights(0,staticCapture?[]:indirectSurfaceLights(lights,lights.map(l=>({position:l.position.toArray()}))))
  const gpuTarget = new WebGLRenderTarget(coefficientCount,4,{type:HalfFloatType,format:RGBAFormat,depthBuffer:false})
  const results=[]
  const freshCapture=async()=>{
    updateSky()
    if (dynamicSun) {
      renderer.shadowMap.autoUpdate=true;renderer.setRenderTarget(null);renderer.render(scene,camera.children[0]);renderer.shadowMap.autoUpdate=false
      const copy=indirectSurfaceSun(capture.scene)!;copy.position.copy(sun.position);copy.color.copy(sun.color);copy.intensity=sun.intensity
      copy.target.position.copy(sun.target.position);copy.updateMatrixWorld(true);copy.target.updateMatrixWorld(true)
    }
    capture.scene.add(...lights,spot.target);updateLights()
    try{
      for(let face=0;face<6;face++){renderer.setRenderTarget(cube,face);renderer.clear();renderer.render(capture.scene,camera.children[face])}
      renderer.setRenderTarget(null);return await integrator.read(renderer,cube)
    }finally{capture.scene.remove(...lights,spot.target)}
  }
  await freshCapture() // Exclude first draw/driver preparation from timings.
  const run=async(name:string)=>{
    if(dynamicSun)await freshCapture() // Refresh the displayed shadow map before cached receiver evaluation.
    const started=performance.now()
    const relit=await cache.relight(0,camera.position.toArray(),indirectSurfaceLights(lights,lights.map(l=>({position:l.position.toArray()}))),dynamicSun?sun:undefined)
    const relightMs=performance.now()-started
    const read = renderer.readRenderTargetPixelsAsync
    renderer.readRenderTargetPixelsAsync = (() => { throw Error('GPU preview attempted a readback') }) as typeof read
    const gpuStart=performance.now()
    try { cache.relightGPU(0,camera.position.toArray(),indirectSurfaceLights(lights,lights.map(l=>({position:l.position.toArray()}))),gpuTarget,2,dynamicSun?sun:undefined) }
    finally { renderer.readRenderTargetPixelsAsync=read }
    const gpuSubmitMs=performance.now()-gpuStart
    const gpuPixels=new Uint16Array(coefficientCount*4);await renderer.readRenderTargetPixelsAsync(gpuTarget,0,2,coefficientCount,1,gpuPixels)
    let gpuError=0
    for(let i=0;i<coefficientCount;i++)for(let c=0;c<3;c++)gpuError=Math.max(gpuError,Math.abs(DataUtils.fromHalfFloat(gpuPixels[i*4+c])-relit.coefficients[i].getComponent(c)))
    if(gpuError>.00001)throw Error('GPU coefficients differ: '+gpuError)
    const freshStart=performance.now()
    const fresh=await freshCapture()
    const freshMs=performance.now()-freshStart
    const second=await cache.read(0,2)
    results.push({name,...compare(relit,fresh),secondBounce:compare(second,fresh).max,relightMs,freshMs,gpuError,gpuSubmitMs})
    return fresh
  }
  await run('unchanged')
  if(skyTest){for(const intensity of [0,.5,1.5,2,3,1,0,3,1]){uniforms.hdSkyRadianceBase.value.set(.65,.72,.82).multiplyScalar(intensity);await run('sky-'+intensity)}uniforms.hdSkySunIrradiance.value.set(0,0,0);await run('solar-ground-off');uniforms.hdSkySunIrradiance.value.set(.6,.5,.4);await run('solar-ground-restored')}
  point.intensity=8;point.color.set('#aaff80');spot.intensity=2;await run('power-colour')
  point.distance=3;point.decay=2;spot.angle=Math.PI/5;spot.penumbra=.6;await run('range-spread')
  point.position.set(.7,.7,1.8);spot.target.position.set(2.7,0,1.8)
  const moved=prepareIndirectCache(floors,lights.map(l=>l.position.toArray()),snapshots,[],undefined,undefined,undefined,undefined,shOrder);prepared.push(moved)
  updateIndirectUniforms(uniforms,moved.field);uniforms.hdGICapture.value=1
  const blocked=await run('move-behind-occluder')
  // Removing blocker IDs must change the reference; matching two unoccluded
  // implementations would not verify that cached relighting preserves walls.
  const distanceData=moved.field.distanceData.slice()
  moved.field.distanceData.fill(0);moved.field.distances.needsUpdate=true
  const open=await freshCapture(),occlusion=compare(blocked,open)
  moved.field.distanceData.set(distanceData);moved.field.distances.needsUpdate=true
  point.intensity=0;spot.intensity=0;await run('lights-off')
  if (dynamicSun) {
    sun.position.set(-3,6,1);sun.color.set('#ffe0aa');sun.intensity=1.5;await run('sun-move-colour')
    sun.intensity=0;await run('sun-off')
    sun.intensity=.8;sun.position.set(7,5,-2);await run('sun-on-new-direction')
    renderer.shadowMap.enabled=false;sun.castShadow=false
    indirectSurfaceSun(capture.scene)!.castShadow=false
    await run('sun-shadows-disabled')
  }
  gpuTarget.dispose()
  Object.assign(window,{surfaceRelightingResult:{results,compileMs,occlusion,glError:renderer.getContext().getError(),relighting:cache.relighting}})
} catch(error){Object.assign(window,{surfaceRelightingResult:{error:String(error)}})}
finally{sourceSky.dispose();cache.dispose();capture.dispose();combined.dispose();cube.dispose();integrator.dispose();normal.dispose();emission.dispose();roomTexture.dispose();prepared.forEach(p=>p.dispose())}

