import { BoxGeometry, Color, DataTexture, DoubleSide, EquirectangularReflectionMapping, FloatType, Mesh, MeshPhysicalMaterial, PerspectiveCamera, RGBAFormat, Scene, WebGLRenderer } from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { configurePreparedCamera } from '../../src/lightingLab/preparedCameraShader'
import { preparedIntegrator, disposePreparedTracer } from '../../src/lightingLab/preparedIntegrator'

const renderer = new WebGLRenderer(); renderer.setSize(16, 16)
const scene = new Scene(), camera = new PerspectiveCamera()
const pixels = new Float32Array(16 * 8 * 4).fill(1)
const sky = new DataTexture(pixels, 16, 8, RGBAFormat, FloatType)
sky.mapping = EquirectangularReflectionMapping; sky.needsUpdate = true
scene.environment = scene.background = sky
const receiver = new DataTexture(new Float32Array([0,0,0,1]), 1, 1, RGBAFormat, FloatType)
const normal = new DataTexture(new Float32Array([0,1,0,1]), 1, 1, RGBAFormat, FloatType)
receiver.needsUpdate = normal.needsUpdate = true
const tracer = new WebGLPathTracer(renderer); tracer.bounces = 16; tracer.transmissiveBounces = 16
tracer.textureSize.set(16,16)
const integrator = preparedIntegrator(tracer)
tracer.setScene(scene,camera);configurePreparedCamera(integrator.material,receiver,normal)
integrator.setSize(16,16);integrator.tiles.set(1,1)
const data = new Float32Array(16*16*4)
async function solve() {
 integrator.reset()
 while(integrator.samples<64){integrator.update();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))}
 const broken = renderer.info.programs?.find(p=>(p as unknown as {diagnostics?:{runnable:boolean}}).diagnostics?.runnable===false)
 if(broken)throw Error('Prepared transport shader failed to compile')
 await renderer.readRenderTargetPixelsAsync(integrator.target,0,0,16,16,data)
 let sum=0;for(let i=0;i<data.length;i+=4)sum+=data[i]
 return sum/(16*16)
}
try {
 const uniformSky = await solve()
 const room = new Mesh(new BoxGeometry(4,4,4),new MeshPhysicalMaterial({color:new Color(.6,.6,.6),roughness:1,side:DoubleSide}))
 scene.add(room);tracer.setScene(scene,camera)
 const sealedRoom = await solve()
 let receiversDisposed=0
 receiver.addEventListener('dispose',()=>receiversDisposed++)
 normal.addEventListener('dispose',()=>receiversDisposed++)
 const texturesBeforeDisposal=renderer.info.memory.textures
 disposePreparedTracer(tracer)
 const texturesAfterDisposal=renderer.info.memory.textures
 Object.assign(window,{preparedResult:{uniformSky,sealedRoom,expectedSky:1,expectedSealed:0,
   receiversDisposed,texturesBeforeDisposal,texturesAfterDisposal}})
} catch(error) { Object.assign(window,{preparedFailure:String(error)}) }
