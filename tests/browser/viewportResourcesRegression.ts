import { BackSide, BoxGeometry, CubeCamera, Data3DTexture, DataTexture, DataUtils, FloatType, GLSL3, HalfFloatType,
  LinearSRGBColorSpace, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, PMREMGenerator, RGBAFormat,
  Scene, ShaderMaterial, Vector3, WebGLCubeRenderTarget, WebGLRenderer, WebGLRenderTarget, MeshStandardMaterial, PointLight, BatchedMesh, Matrix4 } from 'three'
import { prepareTextureReplacement, prepareTextureUpload } from '../../src/textureUpload'
import { IndirectReflectionClient } from '../../src/indirectReflectionClient'
import { compileShaderWarmup, createShaderWarmupSnapshot, prepareShaderWarmupResources } from '../../src/shaderWarmup'
import { retainViewportScene } from '../../src/retainedViewportScene'
const renderer = new WebGLRenderer(), result: Record<string, unknown> = {}
const scene = new Scene(), camera = new OrthographicCamera(-1,1,1,-1,0,1), plane = new PlaneGeometry(2,2)
const output = new WebGLRenderTarget(1,1,{ type:FloatType,format:RGBAFormat,depthBuffer:false })
for (const depth of [1,32]) {
  const width = 256, height = depth===1 ? 256 : 16, data = new Float32Array(width*height*depth*4)
  for (let z=0;z<depth;z++) for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const offset=((z*height+y)*width+x)*4
    data.set([x/width,y/height,z/depth,1],offset)
  }
  const texture = depth===1 ? new DataTexture(data,width,height,RGBAFormat,FloatType) : new Data3DTexture(data,width,height,depth)
  texture.type=FloatType;texture.format=RGBAFormat;texture.needsUpdate=true
  if (!await prepareTextureUpload(renderer,texture)) throw Error('Texture upload cancelled unexpectedly')
  for (let i=0;i<data.length;i+=4) data[i]+=.125
  texture.needsUpdate=true
  if (!await prepareTextureUpload(renderer,texture)) throw Error('Texture update cancelled unexpectedly')
  const material=new ShaderMaterial({ glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{ map:{ value:texture },at:{ value:new Vector3() } },
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`uniform ${depth===1?'sampler2D':'sampler3D'} map;uniform vec3 at;out vec4 colour;void main(){colour=texture(map,at.${depth===1?'xy':'xyz'});}`,
  })
  const mesh=new Mesh(plane,material);scene.add(mesh)
  for(const [x,y,z] of [[0,0,0],[127,height-1,depth-1],[255,3,7%depth]]) {
    material.uniforms.at.value.set((x+.5)/width,(y+.5)/height,(z+.5)/depth)
    renderer.setRenderTarget(output);renderer.render(scene,camera);renderer.setRenderTarget(null)
    const pixel=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(output,0,0,1,1,pixel)
    const expected=[x/width+.125,y/height,z/depth,1]
    if(expected.some((value,i)=>Math.abs(value-pixel[i])>.0001)) throw Error(`Incorrect ${depth===1?'2D':'3D'} upload: ${[...pixel]} expected ${expected}`)
  }
  for(let i=0;i<data.length;i+=4)data[i]+=.125
  const replacement=await (texture instanceof Data3DTexture?prepareTextureReplacement(renderer,texture,()=>false):prepareTextureReplacement(renderer,texture,()=>false))
  if(!replacement)throw Error('Replacement upload cancelled unexpectedly')
  material.uniforms.at.value.set(128.5/width,3.5/height,.5/depth)
  const readRed=async()=>{
    renderer.setRenderTarget(output);renderer.render(scene,camera);renderer.setRenderTarget(null)
    const pixel=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(output,0,0,1,1,pixel);return pixel[0]
  }
  if(Math.abs(await readRed()-.625)>.0001)throw Error('Background upload altered the currently displayed texture')
  material.uniforms.map.value=replacement
  if(Math.abs(await readRed()-.75)>.0001)throw Error('Completed replacement texture was not ready to publish')
  replacement.dispose()
  result[depth===1?'texture2D':'texture3D']='exact; previous GPU data preserved until replacement';scene.remove(mesh);texture.dispose();material.dispose()
}
const cube=new WebGLCubeRenderTarget(32,{ type:HalfFloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,generateMipmaps:false })
const box=new BoxGeometry(10,10,10),materials=[0xff0000,0x00ff00,0x0000ff,0xffffff,0xffff00,0xff00ff].map(color=>new MeshBasicMaterial({color,side:BackSide}))
scene.add(new Mesh(box,materials));new CubeCamera(.1,100,cube).update(renderer,scene)
const generator=new PMREMGenerator(renderer),reference=generator.fromCubemap(cube.texture)
renderer.setRenderTarget(null)
const pixels=new Uint16Array(reference.width*reference.height*4)
await renderer.readRenderTargetPixelsAsync(reference,0,0,reference.width,reference.height,pixels)
const client=new IndirectReflectionClient(),filtered=await client.filter(renderer,cube)
const actual=filtered.texture.image.data as Uint16Array
if(actual.length!==pixels.length)throw Error('Reflection dimensions changed')
let max=0
for(let i=0;i<pixels.length;i++)max=Math.max(max,Math.abs(DataUtils.fromHalfFloat(pixels[i])-DataUtils.fromHalfFloat(actual[i])))
if(max>.003)throw Error('Worker reflection differs from existing PMREM: '+max)
result.reflectionMaxError=max
if(renderer.getContext().getError()!==0)throw Error('Texture/reflection operations left a GL error')
client.dispose();filtered.dispose();reference.dispose();generator.dispose();cube.dispose();box.dispose();materials.forEach(m=>m.dispose())
scene.clear()
const shadowGeometry=new BoxGeometry(),shadowMaterial=new MeshStandardMaterial(),shadowMesh=new Mesh(shadowGeometry,shadowMaterial),light=new PointLight()
shadowMesh.castShadow=true;shadowMesh.receiveShadow=true;light.castShadow=true;scene.add(shadowMesh,light)
renderer.shadowMap.enabled=true
const snapshot=createShaderWarmupSnapshot(scene,{fadeWalls:false,fadeRoofs:false,shadows:true})
await compileShaderWarmup(renderer,snapshot.root,camera,scene)
await prepareShaderWarmupResources(renderer,snapshot.root,camera,scene,false,()=>false)
if(renderer.getContext().getError()!==0)throw Error('Cold shadow resource preparation left a GL error')
if(shadowGeometry.drawRange.count!==Infinity)throw Error('Resource preparation changed live draw ranges')
result.coldShadows='ready without a GL draw'
snapshot.dispose();shadowGeometry.dispose();shadowMaterial.dispose();light.dispose()
scene.clear();renderer.shadowMap.enabled=false
const batchMaterial=new MeshBasicMaterial({color:0xff0000,toneMapped:false}),batchGeometry=new PlaneGeometry(.5,.5)
const batch=new BatchedMesh(1,4,6,batchMaterial),geometryId=batch.addGeometry(batchGeometry),instance=batch.addInstance(geometryId)
batch.frustumCulled=false;batch.setMatrixAt(instance,new Matrix4().makeTranslation(0,0,-.5));scene.add(batch)
const retained=retainViewportScene(scene)
batch.setMatrixAt(instance,new Matrix4().makeTranslation(4,0,-.5))
const readBatch=async(source:Scene)=>{
  renderer.setRenderTarget(output);renderer.render(source,camera);renderer.setRenderTarget(null)
  const pixel=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(output,0,0,1,1,pixel);return pixel[0]
}
if(Math.abs(await readBatch(retained.scene)-1)>.0001)throw Error('Retained batch lost its original transform')
retained.dispose();batch.setMatrixAt(instance,new Matrix4().makeTranslation(0,0,-.5))
if(Math.abs(await readBatch(scene)-1)>.0001)throw Error('Retained batch disposal damaged the live geometry')
if(renderer.getContext().getError()!==0)throw Error('Retained batch left a GL error')
result.retainedBatch='frozen transform; shared prepared geometry; source survives disposal'
batch.dispose();batchGeometry.dispose();batchMaterial.dispose()
plane.dispose();output.dispose();renderer.dispose()
Object.assign(window,{ viewportResourcesResult:result })
