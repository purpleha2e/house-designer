import { BufferAttribute, Color, CubeCamera, HalfFloatType, Mesh, MeshPhysicalMaterial, PMREMGenerator, ShaderChunk, Vector2, WebGLCubeRenderTarget, type Texture, type WebGLRenderTarget } from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import type { HouseSnapshot } from './houseBridge'
import type { HouseLightingLab } from './houseEngine'
import { createHouseReferenceScene } from './houseReferenceScene'
import { configurePreparedCamera } from './preparedCameraShader'
import { LAB_SKY_COLOUR, LAB_SKY_RADIANCE } from './calibration'
import { preparedIntegrator, disposePreparedTracer } from './preparedIntegrator'

/** A completed surface-lighting bake. Navigation never runs the integrator.
 * This first lab mode prepares prototype daylight, with sun and room lamps off. */
export class HousePreparedLighting {
  private cancelled = false
  private display?: Mesh
  private restore = new Map<Mesh, boolean>()
  private reflection?: WebGLRenderTarget
  private textures: Texture[] = []
  private samples = 0
  private started = 0
  private elapsed = 0
  private ready = false
  private installed = false
  private readonly lab: HouseLightingLab
  private readonly snapshot: HouseSnapshot
  readonly targetSamples: number
  constructor(lab: HouseLightingLab, snapshot: HouseSnapshot, targetSamples = 512) {this.lab=lab;this.snapshot=snapshot;this.targetSamples=targetSamples}

  stats() { return { ready: this.ready, samples: this.samples, targetSamples: this.targetSamples, bounces: 32,
    elapsedSeconds: this.elapsed || (this.started ? (performance.now()-this.started)/1000 : 0),
    mode: 'Prepared prototype daylight', reflections: 'One local reflection capture at the preparation camera; approximate in other rooms' } }
  cancel() { this.cancelled = true }
  private check() { if(this.cancelled)throw new DOMException('Lighting preparation cancelled','AbortError') }
  private async gpuComplete() {
    const gl = this.lab.renderer.getContext() as WebGL2RenderingContext
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0)
    if(!fence)throw Error('Could not create a lighting completion fence')
    gl.flush()
    try { for(;;){
      this.check()
      if(gl.isContextLost())throw Error('The GPU context was lost during lighting preparation')
      const result=gl.clientWaitSync(fence,0,0)
      if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return
      if(result===gl.WAIT_FAILED)throw Error('The GPU could not finish lighting preparation')
      await new Promise<void>(resolve=>setTimeout(resolve,8))
    }} finally {gl.deleteSync(fence)}
  }
  async prepare(status:(message:string)=>void) {
    this.started=performance.now();this.lab.setPaused(true)
    const {data,positions,normals}=this.lab.preparedResources(),renderer=this.lab.renderer
    let source: ReturnType<typeof createHouseReferenceScene> | undefined
    let tracer: WebGLPathTracer | undefined
    try {
      source=createHouseReferenceScene(this.snapshot,{daylight:true,lights:[],sunDirection:[0,1,0],sunColour:[0,0,0]},false)
      tracer=new WebGLPathTracer(renderer)
      status('Building full geometry for prepared daylight…')
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));this.check()
      tracer.bounces=32;tracer.transmissiveBounces=32;tracer.filterGlossyFactor=0;tracer.textureSize.set(512,512)
      tracer.setScene(source.scene,this.lab.camera)
      // Version-pinned internal adapter. The public wrapper sizes its render to
      // the viewport; this integrator must instead address the surface atlas.
      const integrator=preparedIntegrator(tracer)
      configurePreparedCamera(integrator.material,positions,normals)
      integrator.setSize(data.width,data.height);integrator.tiles.set(4,Math.ceil(data.height/128));integrator.reset()
      while(integrator.samples<this.targetSamples){
        this.check()
        for(let i=0;i<4&&integrator.samples<this.targetSamples;i++){integrator.update();if(integrator.isCompiling)break}
        if(integrator.isCompiling){status('Compiling preparation shaders…');await new Promise<void>(resolve=>setTimeout(resolve,30));continue}
        // Inspect this integrator, not failures retained from other lab experiments.
        const program=(renderer.properties.get(integrator.material) as {currentProgram?:{diagnostics?:{runnable:boolean}}}).currentProgram
        if(program?.diagnostics?.runnable===false)throw Error('The lighting shader failed to compile; no prepared lighting was installed')
        await this.gpuComplete()
        this.samples=integrator.samples
        status(`Preparing daylight · ${Math.floor(this.samples)} / ${this.targetSamples} samples`)
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
      }
      status('Finishing lighting and reflections…')
      const light=this.lab.filterPreparedLight(integrator.target.texture)
      this.installed=true
      this.installDisplay(light)
      this.captureReflection()
      await this.gpuComplete();this.check()
      this.ready=true;this.elapsed=(performance.now()-this.started)/1000
      this.lab.setLightingFrozen(true);this.lab.setPaused(false)
      status('Ready · lighting stays fixed while you walk')
    } catch(error) {this.dispose();this.lab.setPaused(false);throw error}
    finally {if(tracer)disposePreparedTracer(tracer);source?.dispose()}
  }
  private installDisplay(light:Texture) {
    const {data,geometry:original}=this.lab.preparedResources(),display=data.display??data,geometry=original.clone()
    const uv=new Float32Array(display.chart.length)
    for(let i=0;i<uv.length;i+=2){uv[i]=display.chart[i]/data.width;uv[i+1]=display.chart[i+1]/data.height}
    geometry.setAttribute('uv1',new BufferAttribute(uv,2));light.channel=1
    const copies=new Map<Texture,Texture>()
    const materials=this.snapshot.finishes.map(finish=>{
      const m=finish.referenceMaterial?.clone()??new MeshPhysicalMaterial({roughness:1,metalness:0})
      m.color.fromArray(finish.colour);m.map=finish.map;m.emissive.fromArray(finish.emission);m.emissiveIntensity=1
      m.side=finish.side as 0|1|2;m.alphaTest=finish.alphaTest;m.envMap=null
      for(const key of Object.keys(m)){
        const record=m as unknown as Record<string,unknown>,value=record[key] as Texture|undefined
        if(value?.isTexture){let copy=copies.get(value);if(!copy){copy=value.clone();copy.needsUpdate=true;copies.set(value,copy);this.textures.push(copy)}record[key]=copy}
      }
      // Native Three material expects irradiance; the bake contains E/pi.
      m.lightMap=light;m.lightMapIntensity=Math.PI
      m.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,{preparedAtlasSize:{value:new Vector2(data.width,data.height)},preparedAtlas:{value:light}})
        shader.vertexShader='attribute vec2 vertexLightChart;attribute float vertexLighting;uniform vec2 preparedAtlasSize;uniform sampler2D preparedAtlas;varying vec3 preparedVertexLight;varying float preparedUseVertex;\n'+shader.vertexShader
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vec4 incoming=texture2D(preparedAtlas,vertexLightChart/preparedAtlasSize);
          preparedVertexLight=incoming.rgb/max(incoming.a,.001);preparedUseVertex=vertexLighting;`)
        shader.fragmentShader='varying vec3 preparedVertexLight;varying float preparedUseVertex;\n'+shader.fragmentShader
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',ShaderChunk.lights_fragment_maps
          .replace('lightMapTexel.rgb * lightMapIntensity','(preparedUseVertex>.5?preparedVertexLight:lightMapTexel.rgb/max(lightMapTexel.a,.001))*lightMapIntensity')
          .replace('iblIrradiance += getIBLIrradiance( geometryNormal );',''))
      }
      m.customProgramCacheKey=()=> 'prepared-surface-lighting-v1'
      return m
    })
    this.lab.scene.children.forEach(object=>{if(object instanceof Mesh){this.restore.set(object,object.visible);object.visible=false}})
    this.display=new Mesh(geometry,materials);this.lab.scene.add(this.display)
  }
  private captureReflection() {
    const renderer=this.lab.renderer,target=new WebGLCubeRenderTarget(128,{type:HalfFloatType})
    const camera=new CubeCamera(.04,100,target),pmrem=new PMREMGenerator(renderer)
    camera.position.copy(this.lab.camera.position)
    // Capture actual prepared surfaces. Sky is seen only through real openings;
    // the resulting environment contributes specular, never diffuse ambient.
    const background=this.lab.scene.background;this.lab.scene.background=new Color().fromArray(LAB_SKY_COLOUR).multiplyScalar(LAB_SKY_RADIANCE)
    try {camera.update(renderer,this.lab.scene);this.reflection=pmrem.fromCubemap(target.texture)
      for(const material of this.display!.material as MeshPhysicalMaterial[]) {material.envMap=this.reflection.texture;material.needsUpdate=true}
    } finally {this.lab.scene.background=background;target.dispose();pmrem.dispose()}
  }
  dispose() {
    this.cancelled=true;this.ready=false
    if(this.display){this.lab.scene.remove(this.display);this.display.geometry.dispose();for(const m of this.display.material as MeshPhysicalMaterial[])m.dispose();this.display=undefined}
    this.restore.forEach((visible,mesh)=>mesh.visible=visible);this.restore.clear()
    this.textures.forEach(texture=>texture.dispose());this.textures=[];this.reflection?.dispose();this.reflection=undefined
    if(this.installed){this.lab.restoreLiveLight();this.installed=false}
    this.lab.setLightingFrozen(false)
  }
}
