import { Scene, Mesh, BoxGeometry, PlaneGeometry, MeshStandardMaterial, DirectionalLight,
  PerspectiveCamera, WebGLRenderer, PCFShadowMap, DataTexture, Vector3 } from 'three'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { SunCascades } from '../../src/sunCascades'
import {createOpaqueViewportScene} from '../../src/opaqueViewportScene'

const renderer = new WebGLRenderer({antialias:false, preserveDrawingBuffer:true})
renderer.setSize(800,600); renderer.shadowMap.enabled=true; renderer.shadowMap.type=PCFShadowMap
document.body.append(renderer.domElement)
const scene=new Scene(), camera=new PerspectiveCamera(55,800/600,.05,200)
camera.position.set(0,1.7,1.5);camera.lookAt(0,1.4,0);camera.updateMatrixWorld(true)
const material=new MeshStandardMaterial({color:'white',roughness:1})
applyRoomLightShader(material,createRoomLightShaderUniforms(new DataTexture()))
const wall=new Mesh(new PlaneGeometry(40,20),material);wall.position.set(0,2,-1);wall.receiveShadow=true;scene.add(wall)
const blocker=new Mesh(new BoxGeometry(.3,.8,.1),material);blocker.position.set(0,1.8,0);blocker.castShadow=true;scene.add(blocker)
const sun=new DirectionalLight('white',2);sun.position.set(4,6,7);sun.castShadow=true
sun.userData.houseDesignerRole='sun-light'
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=sun.shadow.camera.bottom=-18
sun.shadow.camera.right=sun.shadow.camera.top=18;sun.shadow.camera.far=120;sun.shadow.camera.updateProjectionMatrix()
sun.shadow.normalBias=.015;scene.add(sun,sun.target)
const cascades=new SunCascades(renderer), original=renderer.shadowMap.render.bind(renderer.shadowMap)
let enabled=false
renderer.shadowMap.render=(lights,s,c)=>{
  cascades.disable();const extra=enabled?cascades.prepare(c,sun,s,renderer.shadowMap.type):[]
  original([...lights,...extra],s,c);if(extra.length)cascades.publish()
}
function render(active:boolean){enabled=active;scene.updateMatrixWorld(true);renderer.render(scene,camera)
 const pixels=new Uint8Array(800*600*4);renderer.getContext().readPixels(0,0,800,600,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels)
 return pixels
}
const before=render(false),beforeImage=renderer.domElement.toDataURL(),after=render(true),afterImage=renderer.domElement.toDataURL()
const idle=render(true)
let changed=0,idleChanged=0,litError=0,litSamples=0,shadowSamples=0
for(let i=0;i<before.length;i+=4){
 if(Math.abs(before[i]-after[i])>3)changed++
 if(idle[i]!==after[i])idleChanged++
 if(before[i]>150&&after[i]>150){litError+=Math.abs(before[i]-after[i]);litSamples++}
 if(after[i]<10&&before[i]<10)shadowSamples++
}
const widths=cascades.lights.map(l=>l.shadow.camera.right-l.shadow.camera.left)
// Move camera and check cascades actually follow it.
const position=cascades.lights[0].position.clone();camera.position.x+=2;camera.updateMatrixWorld(true);render(true)
const movement=position.distanceTo(cascades.lights[0].position)
// A roof upstream, well outside the camera view, must still cast a shadow.
const roof=new Mesh(new BoxGeometry(30,1,30),material);roof.position.copy(camera.position).addScaledVector(new Vector3().copy(sun.position).normalize(),15)
roof.castShadow=true;scene.add(roof);const covered=render(true);let coveredLit=0
for(let y=150;y<450;y++)for(let x=200;x<600;x++)if(covered[(y*800+x)*4]>150)coveredLit++
Object.assign(window,{sunCascadesResult:{changed,idleChanged,litError:litError/litSamples,litSamples,shadowSamples,widths,movement,coveredLit},sunCascadesImages:{before:beforeImage,after:afterImage}})
roof.visible=false;camera.position.x=0;camera.updateMatrixWorld(true);render(true)
const preview=createOpaqueViewportScene(scene,{lighting:true})
renderer.render(preview.scene,camera)
const previewPixels=new Uint8Array(800*600*4),context=renderer.getContext()
context.readPixels(0,0,800,600,context.RGBA,context.UNSIGNED_BYTE,previewPixels)
let previewShadowPixels=0
for(let i=0;i<previewPixels.length;i+=4)if(previewPixels[i]<10)previewShadowPixels++
preview.dispose()
const captureReference=render(false)
material.defines={...material.defines,HD_GI_CAPTURE_VISIBILITY:1};material.needsUpdate=true
const capturePixels=render(true)
let captureChanged=0
for(let i=0;i<capturePixels.length;i++)if(capturePixels[i]!==captureReference[i])captureChanged++
Object.assign(Reflect.get(window,'sunCascadesResult'),{previewShadowPixels,captureChanged})
