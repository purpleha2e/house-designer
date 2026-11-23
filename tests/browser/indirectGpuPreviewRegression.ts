import { BoxGeometry, DataUtils, Group, HalfFloatType, Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry,
  RGBAFormat, Scene, ShaderMaterial, Vector4, WebGLRenderTarget, WebGLRenderer } from 'three'
import { prepareIndirectCache } from '../../src/indirectLightingCache'
import { snapshotIndirectGeometry } from '../../src/indirectVisibility'
import { createIndirectGpuPreview } from '../../src/indirectGpuPreview'
import {requestedIndirectSpatialInterpolation} from '../../src/indirectSpatialInterpolation'
import { IndirectLightingClient } from '../../src/indirectLightingClient'
import { serializeIndirectField } from '../../src/indirectLighting'

const renderer = new WebGLRenderer({antialias:false}); renderer.setSize(32,32); document.body.append(renderer.domElement)
const coefficientsOnly = new URLSearchParams(location.search).has('floatField')
const floors = [0, 1].map(i => ({id:'floor'+i,elevation:i*3,height:2.5,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}]}))
const scene = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(.08,6,4)
const wall = new Mesh(geometry,material); wall.position.set(2,3,2); scene.add(wall)
const tableGeometry=new BoxGeometry(1.2,.1,1.2),table=new Mesh(tableGeometry,material);table.position.set(1,.85,2);scene.add(table)
if (coefficientsOnly) {
  // Leave a door opening in the wall and a stair opening in the storey slab.
  wall.geometry = new BoxGeometry(.08,6,2.5); wall.position.z = 1.25
  const header = new Mesh(new BoxGeometry(.08,3.6,1.5), material); header.position.set(2,4.2,3.25); scene.add(header)
  const slab = new Mesh(new BoxGeometry(4,.12,3), material); slab.position.set(2,2.94,1.5); scene.add(slab)
}
const cache = prepareIndirectCache(floors,[],snapshotIndirectGeometry(scene),[],undefined,undefined,undefined,undefined,1,requestedIndirectSpatialInterpolation())
const field = cache.field, graphStarted = performance.now(), client = new IndirectLightingClient()
const graph = coefficientsOnly
  ? await client.gpuPreview(true, { field: serializeIndirectField(field), geometry: snapshotIndirectGeometry(scene) }).finally(() => client.dispose())
  : cache.gpuPreview()
const graphMs = performance.now() - graphStarted
const gpu = createIndirectGpuPreview(renderer,field,graph,coefficientsOnly ? 'coefficients' : 'relight')
const camera = new OrthographicCamera(-1,1,1,-1,0,1), readScene = new Scene(), readGeometry = new PlaneGeometry(2,2)
const readMaterial = new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{map:{value:gpu.field.volume.maps[0]},n:{value:1},height:{value:1}},
  vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`precision highp sampler3D;uniform sampler3D map;uniform int n,height;
    void main(){ivec2 p=ivec2(gl_FragCoord.xy);gl_FragColor=texelFetch(map,ivec3(p.x,p.y%height,p.y/height),0);}`})
readScene.add(new Mesh(readGeometry,readMaterial))
const readLayer=async(floor:boolean)=>{
  const layer=floor?gpu.field.floorLayer:gpu.field.volume, map=floor?gpu.field.floorLayer.texture:gpu.field.volume.maps[0]
  const target=new WebGLRenderTarget(layer.n,layer.n*layer.height*4,{type:HalfFloatType,format:RGBAFormat,depthBuffer:false})
  readMaterial.uniforms.map.value=map;readMaterial.uniforms.n.value=layer.n;readMaterial.uniforms.height.value=layer.height*4
  renderer.setRenderTarget(target);renderer.render(readScene,camera);renderer.setRenderTarget(null)
  const pixels=new Uint16Array(layer.data.length);await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels);target.dispose();return pixels
}
const compare=(actual:Uint16Array,expected:Uint16Array)=>{
  let error=0,coverage=0,lit=0
  actual.forEach((v,i)=>{const a=DataUtils.fromHalfFloat(v),b=DataUtils.fromHalfFloat(expected[i]);error=Math.max(error,Math.abs(a-b));if(i%4===3&&a!==b)coverage++;if(a)lit++})
  if(error>.003||coverage)throw Error(JSON.stringify({error,coverage,lit}));return {error,coverage,lit}
}
async function compareRenderedReceivers() {
  const target = new WebGLRenderTarget(112,80,{depthBuffer:false})
  const material = new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{volume:{value:null},floor:{value:null}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`precision highp sampler3D;uniform sampler3D volume,floor;
      void main(){
        vec2 xz=gl_FragCoord.xy/vec2(112.,80.);
        bool floorLayer=gl_FragCoord.y<40.;
        vec3 uv=vec3(xz.x,floorLayer?.25:.31,xz.y);
        vec4 a=floorLayer?texture(floor,uv):texture(volume,uv);
        uv.y+=.25;vec3 b=floorLayer?texture(floor,uv).rgb:texture(volume,uv).rgb;
        uv.y+=.25;vec3 c=floorLayer?texture(floor,uv).rgb:texture(volume,uv).rgb;
        uv.y+=.25;vec3 d=floorLayer?texture(floor,uv).rgb:texture(volume,uv).rgb;
        vec3 color=(.886227*a.rgb + 1.023328*(.72*b+.49*c+.49*d))/max(.00001,a.a);
        gl_FragColor=vec4(max(color,vec3(0.)),a.a);
      }`})
  const original = readScene.children[0] as Mesh, originalMaterial = original.material
  original.material = material
  const draw = async (source: typeof field) => {
    material.uniforms.volume.value = source.volume.maps[0]
    material.uniforms.floor.value = source.floorLayer.texture
    renderer.setRenderTarget(target);renderer.render(readScene,camera);renderer.setRenderTarget(null)
    return renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,new Uint8Array(target.width*target.height*4))
  }
  try {
    field.volume.maps[0].needsUpdate = true
    const CPU = await draw(field), GPU = await draw(gpu.field)
    let maxChannelError=0, differingChannels=0
    for(const [i,value] of CPU.entries()){
      const error=Math.abs(value-GPU[i]);maxChannelError=Math.max(maxChannelError,error);if(error)differingChannels++
    }
    if(maxChannelError>1)throw Error('Rendered receiver mismatch: '+maxChannelError)
    return {pixels:CPU.length/4,maxChannelError,differingChannels}
  } finally { original.material=originalMaterial;material.dispose();target.dispose() }
}
try {
  await gpu.compile()
  const results=[]
  if (coefficientsOnly) {
    const indices = Uint32Array.from(field.probes, p => p.index)
    for (const pattern of ['uniform', 'signed directional', 'weak support']) {
      const positions = field.positionData.slice(), coefficients = field.coefficients.map(a => a.slice())
      const values = new Float32Array(indices.length * 12)
      for (const [i, index] of indices.entries()) {
        if (pattern === 'weak support' && i % 5 > 0) positions[index * 4 + 3] = 0
        for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) {
          const value = pattern === 'uniform' ? (k === 0 ? 1 : 0) : ((i + 2 * c + 3 * k) % 9 - 4) / 8
          values[i * 12 + k * 3 + c] = value
          coefficients[c][index * 4 + k] = DataUtils.toHalfFloat(value)
        }
      }
      cache.volume(coefficients, positions)
      const expectedVolume = field.volume.data.slice(), expectedFloor = field.floorLayer.data.slice()
      if (!gpu.begin()) throw Error('GPU timer unexpectedly busy')
      const started = performance.now()
      try { gpu.setCoefficients(values, indices, positions); gpu.publish() } finally { gpu.end() }
      const cpuMs = performance.now() - started
      const volume = compare(await readLayer(false), expectedVolume), floor = compare(await readLayer(true), expectedFloor)
      const timerDeadline = performance.now() + 1000
      while (!gpu.pollTimer() && performance.now() < timerDeadline) await new Promise(requestAnimationFrame)
      results.push({ pattern, cpuMs, gpuMs: gpu.gpuMs || null, volume, floor })
    }
    const renderedReceivers = await compareRenderedReceivers()
    Object.assign(window,{gpuPreviewResult:{results,mode:field.spatialInterpolation, graphMs, renderedReceivers,
      volumeSize:gpu.field.volume.n,floorSize:gpu.field.floorLayer.n,sourceResourcesPreserved:
        field.volume.maps[0] !== gpu.field.volume.maps[0] && field.floorLayer.texture !== gpu.field.floorLayer.texture,
      glError:renderer.getContext().getError()}})
  } else {
  for(const partial of [false,true,false]){
    const positions=field.positionData.slice()
    const coefficients=field.coefficients.map((a,c)=>a.map((_,i)=>DataUtils.toHalfFloat((c+1)*(.2+(i%19)/30))))
    if(partial)field.probes.forEach((p,i)=>{if(i%3)positions[p.index*4+3]=0})
    const reference=cache.preview(coefficients,positions)
    const read=renderer.readRenderTargetPixelsAsync;renderer.readRenderTargetPixelsAsync=(()=>{throw Error('GPU publication readback')}) as typeof read
    try {gpu.seed(coefficients,coefficients,positions);gpu.publish()}finally{renderer.readRenderTargetPixelsAsync=read}
    results.push({partial,volume:compare(await readLayer(false),reference.volume),floor:compare(await readLayer(true),reference.floor)})
  }
  // A measured black update must remove direct light while retaining the old
  // indirect bounce, and only touch the affected interpolation neighbourhood.
  const direct=field.coefficients.map(a=>a.map(()=>DataUtils.toHalfFloat(.25)))
  const settled=field.coefficients.map(a=>a.map(()=>DataUtils.toHalfFloat(.5)))
  const positions=field.positionData.slice(), expected=settled.map(a=>a.slice())
  gpu.seed(direct,settled,positions);gpu.publish()
  const writeScene=new Scene(),writeMaterial=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}'})
  writeScene.add(new Mesh(readGeometry,writeMaterial))
  for(const probe of [field.probes[0],field.probes.at(-1)!]) {
    gpu.coefficients.viewport.set(0,probe.index,4,1);gpu.coefficients.scissor.set(0,probe.index,4,1);gpu.coefficients.scissorTest=true
    const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),auto=renderer.autoClear
    renderer.autoClear=false;renderer.setRenderTarget(gpu.coefficients);renderer.render(writeScene,camera);renderer.setRenderTarget(target,face,mip);renderer.autoClear=auto
    expected.forEach(a=>a.fill(DataUtils.toHalfFloat(.25),probe.index*4,probe.index*4+4))
    const viewport=new Vector4();renderer.getViewport(viewport)
    gpu.publish([probe.index])
    if(!renderer.getViewport(new Vector4()).equals(viewport)||renderer.getRenderTarget()!==target||renderer.autoClear!==auto)throw Error('GPU publication changed renderer state')
    const reference=cache.preview(expected,positions)
    results.push({partial:false,volume:compare(await readLayer(false),reference.volume),floor:compare(await readLayer(true),reference.floor)})
  }
  writeMaterial.dispose()
  Object.assign(window,{gpuPreviewResult:{results,mode:field.spatialInterpolation,localCells:cache.interpolationStatistics().previewFloor.localFloorCells,glError:renderer.getContext().getError()}})
  }
}catch(error){Object.assign(window,{gpuPreviewResult:{error:String(error),stack:(error as Error).stack}})}
finally{
  gpu.dispose();gpu.field.dispose();cache.dispose();material.dispose();geometry.dispose();tableGeometry.dispose();readMaterial.dispose();readGeometry.dispose()
  if (coefficientsOnly) for (const mesh of scene.children.slice(2)) (mesh as Mesh).geometry.dispose()
  if (wall.geometry !== geometry) wall.geometry.dispose()
}
