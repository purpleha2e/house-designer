import { BoxGeometry, DataUtils, Group, HalfFloatType, Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry,
  RGBAFormat, Scene, ShaderMaterial, Vector4, WebGLRenderTarget, WebGLRenderer } from 'three'
import { prepareIndirectCache } from '../../src/indirectLightingCache'
import { snapshotIndirectGeometry } from '../../src/indirectVisibility'
import { createIndirectGpuPreview } from '../../src/indirectGpuPreview'
import {requestedIndirectSpatialInterpolation} from '../../src/indirectSpatialInterpolation'

const renderer = new WebGLRenderer({antialias:false}); renderer.setSize(32,32); document.body.append(renderer.domElement)
const floors = [0, 1].map(i => ({id:'floor'+i,elevation:i*3,height:2.5,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}]}))
const scene = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(.08,6,4)
const wall = new Mesh(geometry,material); wall.position.set(2,3,2); scene.add(wall)
const tableGeometry=new BoxGeometry(1.2,.1,1.2),table=new Mesh(tableGeometry,material);table.position.set(1,.85,2);scene.add(table)
const cache = prepareIndirectCache(floors,[],snapshotIndirectGeometry(scene),[],undefined,undefined,undefined,undefined,1,requestedIndirectSpatialInterpolation())
const field = cache.field, gpu = createIndirectGpuPreview(renderer,field,cache.gpuPreview())
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
try {
  await gpu.compile()
  const results=[]
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
}catch(error){Object.assign(window,{gpuPreviewResult:{error:String(error),stack:(error as Error).stack}})}
finally{gpu.dispose();gpu.field.dispose();cache.dispose();material.dispose();geometry.dispose();tableGeometry.dispose();readMaterial.dispose();readGeometry.dispose()}
