import {BufferAttribute,BufferGeometry,Color,CubeCamera,DoubleSide,FloatType,Mesh,NearestFilter,Scene,ShaderMaterial,Vector3,WebGLCubeRenderTarget,WebGLRenderTarget,type WebGLRenderer,type Camera} from 'three'
import type {IndirectVisibility} from '../../src/indirectVisibility.ts'

export type DepthCube={position:number[];size:number;faces:Float32Array[]}
export function depthVisible(cube:DepthCube,receiver:number[],tolerance=.002){
  const d=new Vector3().fromArray(receiver).sub(new Vector3().fromArray(cube.position)),distance=d.length(),x=Math.abs(d.x),y=Math.abs(d.y),z=Math.abs(d.z)
  if(distance<.0001)return true
  let face:number,u:number,v:number
  if(x>=y&&x>=z){face=d.x>=0?0:1;u=(d.x>=0?-d.z:d.z)/x;v=d.y/x}
  else if(y>=z){face=d.y>=0?2:3;u=d.x/y;v=(d.y>=0?-d.z:d.z)/y}
  else{face=d.z>=0?4:5;u=(d.z>=0?d.x:-d.x)/z;v=d.y/z}
  // readRenderTargetPixels is bottom-up; Three CubeCamera's up conventions
  // match these ray directions, with row v=+1 at the first readback row.
  const col=Math.max(0,Math.min(cube.size-1,Math.floor((u+1)*.5*cube.size))),row=Math.max(0,Math.min(cube.size-1,Math.floor((1-v)*.5*cube.size)))
  return distance<=cube.faces[face][row*cube.size+col]+tolerance
}

/** Dedicated radial-depth raster experiment; same opaque triangles as the BVH,
 * independent depth resolution, no lighting resolution or production changes. */
export async function captureDepth(gl:WebGLRenderer,visibility:IndirectVisibility,probes:{index:number;position:number[]}[],size:number){
  const start=performance.now(),geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(visibility.snapshot().positions,3)),scene=new Scene(),uniform={value:new Vector3()},material=new ShaderMaterial({side:DoubleSide,uniforms:{probePosition:uniform},vertexShader:'varying vec3 world;void main(){world=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 probePosition;varying vec3 world;void main(){float radial=length(world-probePosition);gl_FragColor=vec4(radial,0.,0.,1.);gl_FragDepth=radial/80.;}',toneMapped:false}),target=new WebGLRenderTarget(size,size,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter}),cubeTarget=new WebGLCubeRenderTarget(size),camera=new CubeCamera(.0001,80,cubeTarget)
  scene.add(new Mesh(geometry,material));camera.coordinateSystem=gl.coordinateSystem;camera.updateCoordinateSystem()
  const savedTarget=gl.getRenderTarget(),face=gl.getActiveCubeFace(),mip=gl.getActiveMipmapLevel(),auto=gl.autoClear,clear=gl.getClearColor(new Color()),alpha=gl.getClearAlpha(),shadowAuto=gl.shadowMap.autoUpdate,shadowNeeds=gl.shadowMap.needsUpdate
  const context=gl.getContext() as WebGL2RenderingContext,timer=context.getExtension('EXT_disjoint_timer_query_webgl2'),queries:WebGLQuery[]=[],cubes=new Map<number,DepthCube>();let submissionMs=0,readbackWallMs=0
  try{
    gl.autoClear=true;gl.setClearColor(new Color(80,0,0),1);gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false
    for(const probe of probes){const faces:Float32Array[]=[];uniform.value.fromArray(probe.position);camera.position.copy(uniform.value);camera.updateMatrixWorld(true)
      for(let f=0;f<6;f++){
        const query=timer&&!context.getQuery(timer.TIME_ELAPSED_EXT,context.CURRENT_QUERY)?context.createQuery():null,at=performance.now();if(query)context.beginQuery(timer!.TIME_ELAPSED_EXT,query)
        gl.setRenderTarget(target);gl.render(scene,camera.children[f] as Camera);if(query){context.endQuery(timer!.TIME_ELAPSED_EXT);queries.push(query)}submissionMs+=performance.now()-at
        const pixels=new Float32Array(size*size*4),readAt=performance.now();await gl.readRenderTargetPixelsAsync(target,0,0,size,size,pixels);readbackWallMs+=performance.now()-readAt
        faces.push(Float32Array.from({length:size*size},(_,i)=>pixels[i*4]))
      }
      cubes.set(probe.index,{position:probe.position,size,faces})
    }
    let gpuMs=0,gpuSamples=0;const disjoint=timer&&context.getParameter(timer.GPU_DISJOINT_EXT)
    for(const query of queries)if(!disjoint&&context.getQueryParameter(query,context.QUERY_RESULT_AVAILABLE)){gpuMs+=context.getQueryParameter(query,context.QUERY_RESULT)/1e6;gpuSamples++}
    return{cubes,metrics:{size,probes:probes.length,wallMs:performance.now()-start,submissionMs,readbackWallMs,gpuMs:gpuSamples?gpuMs:null,gpuSamples,draws:probes.length*6,cpuDepthBytes:probes.length*6*size*size*4,gpuReusableTargetBytes:size*size*(16+4),all301RetainedR32FBytesEstimate:301*6*size*size*4,scope:'Separate float radial-depth raster, synchronous sequence with async readback; retained CPU R32F faces; reusable GPU RGBA32F plus assumed 32-bit depth target; whole-house retained R32F figure is an allocation estimate.'}}
  }finally{queries.forEach(q=>context.deleteQuery(q));gl.setRenderTarget(savedTarget,face,mip);gl.autoClear=auto;gl.setClearColor(clear,alpha);gl.shadowMap.autoUpdate=shadowAuto;gl.shadowMap.needsUpdate=shadowNeeds;target.dispose();cubeTarget.dispose();geometry.dispose();material.dispose()}
}
