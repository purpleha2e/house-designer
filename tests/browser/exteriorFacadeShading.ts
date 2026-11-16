import { BoxGeometry, Data3DTexture, Group, LinearFilter, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { bakeExteriorSkyOcclusion, exteriorSkyOcclusionGLSL } from '../../src/exteriorSkyOcclusion'
import { bakeExteriorEaveField } from '../../src/exteriorEaveOcclusion'
import { packExteriorSkyTexture } from '../../src/exteriorSkyTexture'
import { snapshotIndirectGeometry } from '../../src/indirectVisibility'

// An angled facade beneath a thin, boxed roof isolates world-space sky/eave
// shading from direct shadows, screen-space AO and the asynchronous GI bake.
const renderer = new WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
renderer.setSize(1000,600);document.body.append(renderer.domElement)
const params=new URLSearchParams(location.search),overhang=Number(params.get('overhang')??.25)
const scene=new Scene(), house=new Group();house.rotation.y=Number(params.get('angle')??.55);scene.add(house)
const wall: Mesh=new Mesh(new BoxGeometry(6,2.4,4),new MeshStandardMaterial()),roof: Mesh=new Mesh(new BoxGeometry(6+2*overhang,.16,4+2*overhang),new MeshStandardMaterial())
wall.userData.houseDesignerRole='wall-engine-render';roof.userData.houseDesignerRole='roof-eaves'
wall.position.y=1.2;roof.position.y=2.48;house.add(wall,roof);scene.updateMatrixWorld(true)
const field=bakeExteriorSkyOcclusion(snapshotIndirectGeometry(house)),eaves=bakeExteriorEaveField(snapshotIndirectGeometry(roof))
const packed=packExteriorSkyTexture(field,eaves),texture=new Data3DTexture(packed.data,packed.width,packed.height,packed.depth)
texture.format=RGBAFormat;texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true
const uniforms={hdExteriorSkyField:{value:texture},hdExteriorSkyMin:{value:new Vector3().fromArray(field.min)},hdExteriorSkySize:{value:new Vector3().fromArray(field.size)},
 hdExteriorSkyDimensions:{value:new Vector3().fromArray(field.dimensions)},hdExteriorSkyCell:{value:field.cell},hdExteriorSkyStrength:{value:1},
 hdExteriorEaveMin:{value:new Vector2().fromArray(eaves!.min)},hdExteriorEaveSize:{value:new Vector2().fromArray(eaves!.size)},hdExteriorEaveDimensions:{value:new Vector2().fromArray(eaves!.dimensions)},
 hdExteriorEaveHeight:{value:new Vector2(eaves!.heightMin,eaves!.heightRange)},hdExteriorEaveLayers:{value:eaves!.layers},hdExteriorEaveFilterWidth:{value:6}}
const mode={value:0}
const material=(color:Vector3)=>new ShaderMaterial({defines:{HD_EXTERIOR_SKY_OCCLUSION:1},uniforms:{...uniforms,color:{value:color},mode},
 vertexShader:'varying vec3 p,n;void main(){p=(modelMatrix*vec4(position,1.)).xyz;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
 fragmentShader:`varying vec3 p,n;uniform vec3 color;uniform float mode;${exteriorSkyOcclusionGLSL}void main(){vec3 a,b;hdExteriorSkySample(p,normalize(n),a,b);float v=dot(a,vec3(.25,.5,.25));if(mode==1.)v=hdExteriorEaveVisibility(p,normalize(n));gl_FragColor=vec4(color*(.35+.65*v),1.);}`})
wall.material=material(new Vector3(.42,.51,.62));roof.material=material(new Vector3(.94,.94,.94))
const camera=new PerspectiveCamera(42,1000/600,.1,100);camera.position.set(2.4,2.6,8.7);camera.lookAt(0,1.8,0)
renderer.setClearColor('#cbd0d6');renderer.render(scene,camera)
const profileTarget=new WebGLRenderTarget(512,1),profileScene=new Scene(),profileBase=new Vector3()
const profileMaterial=new ShaderMaterial({defines:{HD_EXTERIOR_SKY_OCCLUSION:1},uniforms:{...uniforms,base:{value:profileBase},
 normal:{value:new Vector3(0,0,1).applyEuler(house.rotation)},tangent:{value:new Vector3(1,0,0).applyEuler(house.rotation)}},
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`varying vec2 vUv;uniform vec3 base,normal,tangent;${exteriorSkyOcclusionGLSL}
 void main(){float v=hdExteriorEaveVisibility(base+tangent*(vUv.x-.5)*5.,normal);gl_FragColor=vec4(vec3(v),1.);}`})
profileScene.add(new Mesh(new PlaneGeometry(2,2),profileMaterial))
const facadeProfile=(height:number)=>{
 profileBase.set(0,height,2).applyMatrix4(house.matrixWorld)
 renderer.setRenderTarget(profileTarget);renderer.render(profileScene,new OrthographicCamera())
 const pixels=new Uint8Array(512*4);renderer.readRenderTargetPixels(profileTarget,0,0,512,1,pixels);renderer.setRenderTarget(null)
 const values=Array.from({length:512},(_,i)=>pixels[i*4]),mean=values.reduce((a,b)=>a+b,0)/512
 return {min:Math.min(...values),max:Math.max(...values),mean,deviation:Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/512)}
}
// Compare the compact loop to the previous fixed-bound implementation using
// the same field, receiver positions and six-by-six filter footprint.
const reference=profileMaterial.clone();reference.uniforms=profileMaterial.uniforms
reference.fragmentShader=reference.fragmentShader.replaceAll('< hdExteriorEaveFilterWidth','< 6')
const profileMesh=profileScene.children[0] as Mesh
let filterMaxDifference=0
for(const height of [1.9,2.1,2.32,2.4,2.48]) {
 const frames:Uint8Array[]=[]
 for(const shader of [profileMaterial,reference]) {
  profileMesh.material=shader;profileBase.set(0,height,2).applyMatrix4(house.matrixWorld)
  renderer.setRenderTarget(profileTarget);await renderer.compileAsync(profileScene,new OrthographicCamera());renderer.render(profileScene,new OrthographicCamera())
  const pixels=new Uint8Array(512*4);renderer.readRenderTargetPixels(profileTarget,0,0,512,1,pixels);frames.push(pixels)
 }
 for(let i=0;i<frames[0].length;i++)filterMaxDifference=Math.max(filterMaxDifference,Math.abs(frames[0][i]-frames[1][i]))
}
profileMesh.material=profileMaterial;reference.dispose();renderer.setRenderTarget(null)
Object.assign(window,{filterMaxDifference})
Object.assign(window,{facadeReady:true,facadeProfile,facadeField:{cell:field.cell,layers:eaves!.layers},facadePng:(contactOnly=false)=>{mode.value=contactOnly?1:0;renderer.render(scene,camera);return renderer.domElement.toDataURL()}})
