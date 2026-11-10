import { ACESFilmicToneMapping, BoxGeometry, Color, DataUtils, DirectionalLight, HalfFloatType, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createFastGI, fastGIRoom } from '../../src/fastGI'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { prepareFastCaptureScene } from '../../src/indirectCaptureScene'
import { fastGIShader } from '../../src/fastGIShader'

const renderer=new WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(1000,740);renderer.shadowMap.enabled=true;renderer.toneMapping=ACESFilmicToneMapping;document.body.appendChild(renderer.domElement)
const scene=new Scene();scene.background=new Color().setRGB(.65,.72,.82)
const field=createIndirectField([]),uniforms=createIndirectUniforms(field);uniforms.hdFastFeature.value=1;uniforms.hdGIIndoorFill.value=0
const white=new MeshStandardMaterial({color:new Color().setRGB(.8,.8,.8),roughness:1}),grey=white.clone();grey.color.setRGB(.35,.35,.35)
if(!new URLSearchParams(location.search).has('probe'))for(const material of [white,grey])applyIndirectLightingShader(material,uniforms)
const box=(p:number[],s:number[],material=white)=>{const mesh=new Mesh(new BoxGeometry(...s as [number,number,number]),material);mesh.position.fromArray(p);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);return mesh}
box([2.5,-.1,2],[5.4,.2,4.4],grey);box([2.5,2.9,2],[5.4,.2,4.4])
box([-.1,1.4,2],[.2,2.8,4.4]);box([5.1,1.4,2],[.2,2.8,4.4]);box([2.5,1.4,4.1],[5,.0+2.8,.2])
box([2.5,.4,-.1],[5,.8,.2]);box([2.5,2.65,-.1],[5,.3,.2]);box([.5,1.65,-.1],[1,1.7,.2]);box([4.5,1.65,-.1],[1,1.7,.2])
const shutter=box([2.5,1.65,-.1],[3,1.7,.2]);scene.remove(shutter)
const glass=new MeshStandardMaterial({color:'white',transparent:true,opacity:.08,depthWrite:false});glass.name='window glass'
box([2.5,1.65,-.05],[3,1.7,.02],glass).castShadow=false
const sun=new DirectionalLight('white',3);sun.userData.houseDesignerRole='sun-light';sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,far:30});sun.shadow.normalBias=.005;sun.target.position.set(2.5,0,2);scene.add(sun,sun.target)
const camera=new PerspectiveCamera(65,1000/740,.03,50);camera.position.set(4.7,1.65,3.6);camera.lookAt(2.5,1.3,0)
const floors=[{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}]
const room=fastGIRoom(floors,camera.position)!,engine=createFastGI(renderer,scene,uniforms)!
const receivers=[{name:'floor near window',p:[2.5,.005,1],n:[0,1,0]},{name:'rear wall',p:[2.5,1.4,3.995],n:[0,0,-1]},{name:'ceiling',p:[2.5,2.795,2],n:[0,-1,0]},{name:'shaded corner',p:[.05,1.4,3.7],n:[1,0,0]}]
const sampleMaterial=new ShaderMaterial({defines:{HD_FAST_GI:1},uniforms:{...uniforms,points:{value:receivers.map(r=>new Vector3(...r.p as [number,number,number]))},normals:{value:receivers.map(r=>new Vector3(...r.n as [number,number,number]))}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`${fastGIShader}\nuniform vec3 points[4],normals[4];void main(){int i=int(gl_FragCoord.x);gl_FragColor=vec4(hdFastIrradiance(points[i],normals[i],normals[i],vec3(0.)),1.);}`})
const sampleTarget=new WebGLRenderTarget(4,1,{type:HalfFloatType,depthBuffer:false}),sampleScene=new Scene(),quad=new Mesh(new PlaneGeometry(2,2),sampleMaterial);sampleScene.add(quad)
let revision=0
async function run(condition='away',sealed=false){
  if(sealed)scene.add(shutter);else scene.remove(shutter)
  sun.position.set(2.5,6,condition==='direct'?-6:8);sun.intensity=condition==='overcast'?0:3
  scene.updateMatrixWorld(true);renderer.render(scene,camera)
  const id=engine.request(room,true,true,1);await engine.prepare(id,()=>prepareFastCaptureScene(scene,()=>false))
  await new Promise<void>((resolve,reject)=>{const step=()=>{engine.step({enabled:true,hybrid:true,mode:'fast',viewsPerFrame:3},false,1/60);renderer.render(scene,camera);if(engine.stats.error)reject(Error(engine.stats.error));else if(engine.stats.state==='ready')resolve();else requestAnimationFrame(step)};requestAnimationFrame(step)})
  for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);engine.step({enabled:true,hybrid:true,mode:'fast',viewsPerFrame:3},false,1/60)}
  renderer.setRenderTarget(sampleTarget);renderer.render(sampleScene,new OrthographicCamera(-1,1,1,-1,0,1));renderer.setRenderTarget(null)
  const data=new Uint16Array(16);await renderer.readRenderTargetPixelsAsync(sampleTarget,0,0,4,1,data)
  renderer.render(scene,camera);revision++
  return {condition,sealed,receivers:receivers.map((r,i)=>({...r,irradiance:[0,1,2].map(c=>DataUtils.fromHalfFloat(data[i*4+c]))})),stats:{...engine.stats},textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,glError:renderer.getContext().getError(),revision}
}
Object.assign(window,{daylightReference:{run,engine,renderer,scene,camera,receivers}})
export {renderer,scene,camera,receivers,floors,shutter,sun,white,grey}
