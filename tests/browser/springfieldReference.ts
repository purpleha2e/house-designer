import { ACESFilmicToneMapping, DataTexture, EquirectangularReflectionMapping, FloatType, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, RGBAFormat, Vector2, WebGLRenderer } from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import type { RootState } from '@react-three/fiber'
import { readDiffuseSceneLighting } from '../../src/diffuseSceneSnapshot'
import { snapshotHouseMeshes } from '../../src/lightingLab/houseBridge'
import { createHouseReferenceScene } from '../../src/lightingLab/houseReferenceScene'

/** Independent path transport. The authored meshes/PBR textures, live
 * directional irradiance and display settings are the inputs to this render. */
export async function traceLandingReference(s:RootState, samples=96, renderScale=.36,
  crop?:{x:number;y:number;width:number;height:number},checkpointSamples?:number,compareFull=false) {
  if (!(s.camera instanceof PerspectiveCamera)) throw Error('Expected the landing perspective camera')
  const inputs=readDiffuseSceneLighting(s.scene,1)
  if(inputs.lights.length)throw Error('Artificial lights were enabled for the reference')
  const camera=s.camera.clone(), snapshot=snapshotHouseMeshes(s.scene,camera,{referenceExterior:true})
  const source=createHouseReferenceScene(snapshot,{daylight:true,sunDirection:inputs.sunDirection,sunColour:inputs.sunIrradiance,lights:[]},false,true)
  source.scene.updateMatrixWorld(true)
  const ray=new Raycaster()
  ray.setFromCamera(new Vector2(.53*2-1,1-.84*2),camera)
  const floorHit=ray.intersectObjects(source.scene.children)[0]?.object
  const floorFinish=floorHit instanceof Mesh && floorHit.material instanceof MeshStandardMaterial?{
    role:floorHit.name,colour:floorHit.material.color.toArray(),
    map:floorHit.material.map && {width:floorHit.material.map.image?.width,height:floorHit.material.map.image?.height},
  }:undefined
  const renderer=new WebGLRenderer({ antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance' })
  const fullWidth=s.gl.domElement.width,fullHeight=s.gl.domElement.height
  const width=crop?.width??fullWidth,height=crop?.height??fullHeight
  if(crop)camera.setViewOffset(fullWidth,fullHeight,crop.x,crop.y,width,height)
  renderer.setSize(width,height,false)
  renderer.toneMapping=ACESFilmicToneMapping
  renderer.toneMappingExposure=s.gl.toneMappingExposure
  renderer.outputColorSpace=s.gl.outputColorSpace
  // The editor uses this upper-sky gradient and Lambertian ground for escaping
  // daylight rays. Tabulate it directly in the tracer's equirectangular map.
  const w=128,h=64,pixels=new Float32Array(w*h*4)
  for(let y=0;y<h;y++) {
    const altitude=Math.sin(((y+.5)/h-.5)*Math.PI)
    for(let x=0;x<w;x++)pixels[(y*w+x)*4+3]=1
    for(let x=0;x<w;x++)for(let c=0;c<3;c++)pixels[(y*w+x)*4+c]=altitude>=0
      ? inputs.skyBase[c]*(inputs.skyMode==='overcast'?.5+altitude:.6+.8*altitude)
      : .2*(inputs.skyBase[c]*(inputs.skyMode==='overcast'?7/6:17/15)+inputs.skySun[c]/Math.PI)
  }
  const environment=new DataTexture(pixels,w,h,RGBAFormat,FloatType)
  environment.mapping=EquirectangularReflectionMapping;environment.needsUpdate=true
  if(source.scene.background===source.scene.environment)source.scene.background=environment
  source.scene.environment=environment
  const tracer=new WebGLPathTracer(renderer)
  tracer.renderScale=renderScale;tracer.bounces=8;tracer.transmissiveBounces=12;tracer.renderDelay=0;tracer.fadeDuration=0;tracer.minSamples=1
  const textureSize=crop?1024:512
  tracer.textureSize.set(textureSize,textureSize)
  tracer.rasterizeScene=false
  tracer.tiles.set(2,2)
  const previous=s.frameloop, started=performance.now()
  let checkpoint:string|undefined
  try {
    s.setFrameloop('never')
    const progress={samples:0,stage:'Building reference BVH'}
    s.scene.userData.landingReferenceProgress=progress
    tracer.setScene(source.scene,camera)
    progress.stage='Accumulating paths'
    while(tracer.samples<samples) {
      tracer.renderSample()
      progress.samples=tracer.samples
      if(checkpointSamples && tracer.samples>=checkpointSamples && !checkpoint)checkpoint=renderer.domElement.toDataURL('image/png')
      await new Promise(requestAnimationFrame)
    }
    const image=renderer.domElement.toDataURL('image/png')
    const stats={renderer:'three-gpu-pathtracer',samples:tracer.samples,
      bounces:tracer.bounces,width,height,renderScale:tracer.renderScale,textureSize,triangles:source.triangles,authoredGlazing:true,floorFinish,
      ...(crop&&{crop,fullWidth,fullHeight}),
      camera:camera.matrixWorld.toArray(),projection:camera.projectionMatrix.toArray(),exposure:renderer.toneMappingExposure,
      toneMapping:'ACESFilmic',inputs,elapsedMs:performance.now()-started}
    if(!compareFull || !crop)return {image,...(checkpoint&&{checkpoint}),stats}
    const uv=new Vector2(.19,.37),a=new Raycaster(),b=new Raycaster()
    a.setFromCamera(uv,camera)
    camera.clearViewOffset();camera.updateMatrixWorld(true)
    b.setFromCamera(new Vector2((crop.x+(uv.x*.5+.5)*width)/fullWidth*2-1,1-(crop.y+(1-uv.y)*.5*height)/fullHeight*2),camera)
    const rayError=a.ray.direction.distanceTo(b.ray.direction)
    renderer.setSize(fullWidth,fullHeight,false)
    tracer.renderScale=.4;tracer.setCamera(camera)
    progress.stage='Same frozen snapshot at full view with 40% trace scale'
    while(tracer.samples<96){tracer.renderSample();progress.samples=tracer.samples;await new Promise(requestAnimationFrame)}
    return {image,checkpoint,stats,full:{image:renderer.domElement.toDataURL('image/png'),samples:tracer.samples,rayError,scale:tracer.renderScale}}
  } finally {
    s.setFrameloop(previous);tracer.dispose();environment.dispose();source.dispose();renderer.dispose()
    if(crop)renderer.forceContextLoss()
    snapshot.finishes.forEach(m=>m.referenceMaterial?.dispose())
  }
}
