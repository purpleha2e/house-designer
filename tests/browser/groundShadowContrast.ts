import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three'
import { withGroundShadowContrast } from '../../src/materials/groundShadowContrast'
import { daylightSkyBase, daylightSunAppearance } from '../../src/daylightSky'
import { createIndirectCaptureScene } from '../../src/indirectCaptureScene'
import { configureFastGIShadows } from '../../src/fastGIShadows'

const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
renderer.setSize(800,600);renderer.setClearColor('#b7bdc5');renderer.toneMapping=ACESFilmicToneMapping
renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;document.body.append(renderer.domElement)
const scene=new Scene(),sun=new DirectionalLight('#fff8ee',1.3)
sun.position.set(-4,8,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024)
Object.assign(sun.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});sun.shadow.bias=-.0001
const ambient=new AmbientLight('#ffffff',3)
scene.add(sun,ambient)
const wall=new Mesh(new BoxGeometry(.2,2.4,5),new MeshStandardMaterial({color:'#6b8098',roughness:.8}))
wall.position.y=1.2;wall.castShadow=true;wall.receiveShadow=true;scene.add(wall)
const original=new MeshStandardMaterial({color:'#f8fafc'}),enhanced=original.clone()
const retention={value:.55}
Object.assign(enhanced,withGroundShadowContrast(retention))
const ground=new Mesh(new PlaneGeometry(12,12),original);ground.rotation.x=-Math.PI/2;ground.position.y=-.01;ground.receiveShadow=true;scene.add(ground)
const camera=new PerspectiveCamera(45,800/600,.1,50);camera.position.set(8,6,9);camera.lookAt(0,1,0);camera.updateMatrixWorld()
const pixels=new Uint8Array(800*600*4)
function capture(material:MeshStandardMaterial,weather=false){
 ground.material=material;renderer.render(scene,camera)
 const gl=renderer.getContext();gl.readPixels(0,0,800,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
 const sample=(position:number[])=>{const p=new Vector3().fromArray(position).project(camera),x=Math.round((p.x+1)*400),y=Math.round((p.y+1)*300);const rgb=[0,0,0]
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((y+dy)*800+x+dx)*4;for(let c=0;c<3;c++)rgb[c]+=pixels[i+c]/9}return rgb}
 const mean=(v:number[])=>v.reduce((sum,c)=>sum+c,0)/3,shadowRGB=sample([.6,-.01,0]),litRGB=sample(weather?[.6,-.01,4]:[3,-.01,0])
 return {shadow:mean(shadowRGB),lit:mean(litRGB),shadowRGB,litRGB,wall:mean(sample([.101,1,0])),png:renderer.domElement.toDataURL()}
}
const results=[]
for(const mode of ['on','shadows-off','sun-off','receiver-off']){
 sun.intensity=mode==='sun-off'?0:1.3;sun.shadow.intensity=mode==='shadows-off'?0:1;ground.receiveShadow=mode!=='receiver-off'
 results.push({mode,before:capture(original),after:capture(enhanced)})
}
Object.assign(window,{groundShadowResults:results})
const programsBefore=renderer.info.programs!.length,weatherResults=[]
ground.receiveShadow=true;sun.shadow.intensity=1
for(const mode of ['clear','overcast'] as const)for(const elevation of [1,.08]){
 const sky=daylightSkyBase(mode,elevation).divideScalar(.72),appearance=daylightSunAppearance(elevation,mode)
 ambient.color.setRGB(sky.x,sky.y,sky.z);sun.color.copy(appearance.color);sun.intensity=appearance.intensity
 sun.position.y=Math.tan(elevation)*Math.hypot(4,4);retention.value=mode==='overcast'?.96:.55
 weatherResults.push({mode,elevation,...capture(enhanced,true)})
}
Object.assign(window,{groundWeatherResults:{rows:weatherResults,programsBefore,programsAfter:renderer.info.programs!.length}})

const groundDisplayTint = '#c2c8c4'
const tinted = original.clone()
tinted.userData.groundDisplayTint = groundDisplayTint
Object.assign(tinted, withGroundShadowContrast(retention, undefined, groundDisplayTint))
ground.receiveShadow = false
const { lit: physicalGround, wall: physicalWall } = capture(enhanced)
const { lit: displayGround, wall: displayWall } = capture(tinted)
const transport = createIndirectCaptureScene(scene, false)
const proxy = transport.scene.children.find(object => object instanceof Mesh && object.geometry === ground.geometry) as Mesh
const captureGround = proxy.material as MeshStandardMaterial
const probeGround = capture(captureGround).lit
const nativeShadows = configureFastGIShadows(transport.scene)
const nativeGround = capture(captureGround).lit
nativeShadows.dispose(); transport.dispose(); tinted.dispose()
Object.assign(window, { groundDisplayResults: { physicalGround, displayGround, physicalWall, displayWall, probeGround, nativeGround } })
