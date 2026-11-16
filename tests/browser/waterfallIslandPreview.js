import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
export { THREE }
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1)
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85
document.body.appendChild(renderer.domElement)
const scene=new THREE.Scene();scene.background=new THREE.Color('#ebe8e1')
const camera=new THREE.PerspectiveCamera(34,innerWidth/innerHeight,.01,50)
camera.position.set(-3.7,2.45,4.15)
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.64,0);controls.update()
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer)
scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.5
room.dispose();pmrem.dispose()
scene.add(new THREE.HemisphereLight('#fff8ed','#a1a7ac',.6))
const key=new THREE.DirectionalLight('#fff5e5',2);key.position.set(-3,6,4);key.castShadow=true
key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.bias=-.0003;key.shadow.normalBias=.015;scene.add(key)
const fill=new THREE.DirectionalLight('#e7eef9',.65);fill.position.set(3,3,-3);scene.add(fill)
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e7e3db',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.003;ground.receiveShadow=true;scene.add(ground)
const ktx=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer)
try{
 const gltf=await new GLTFLoader().setKTX2Loader(ktx).loadAsync('/src/models/assets/waterfall_shaker_island.glb')
 gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}})
 scene.add(gltf.scene)
 const bounds=new THREE.Box3().setFromObject(gltf.scene),meshes=[]
 gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o)})
 window.islandPreview={renderer,scene,camera,controls,model:gltf.scene,bounds:bounds.min.toArray().concat(bounds.max.toArray()),meshes:meshes.length,
   triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),
   textures:meshes.filter(m=>m.material.map).map(m=>({width:m.material.map.image.width,height:m.material.map.image.height,compressed:m.material.map.isCompressedTexture}))}
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)})
}catch(error){window.islandPreviewError=String(error);throw error}
