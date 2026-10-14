import { Scene, Mesh, PlaneGeometry, SphereGeometry, MeshStandardMaterial, PointLight, DirectionalLight,
  SpotLight, OrthographicCamera, WebGLRenderer, WebGLRenderTarget, Raycaster, DoubleSide, PCFShadowMap } from 'three'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { DataTexture } from 'three'

const renderer = new WebGLRenderer({ antialias: false })
renderer.setSize(512,512); renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap
document.body.append(renderer.domElement)
const target = new WebGLRenderTarget(512,512), scene = new Scene(), camera = new OrthographicCamera(-5,5,5,-5,.01,30)
const plane = new PlaneGeometry(12,12), sphere = new SphereGeometry(1,48,32)
const legacy = new MeshStandardMaterial({ color:'white',roughness:1,side:DoubleSide,shadowSide:DoubleSide })
const corrected = legacy.clone()
applyRoomLightShader(corrected, createRoomLightShaderUniforms(new DataTexture()))
const mesh = new Mesh(plane,legacy); mesh.rotation.x=-Math.PI/2;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh)
const ray = new Raycaster()
function render(shadowed:boolean) {
  mesh.castShadow=shadowed
  scene.traverse(o=>{if(o instanceof PointLight||o instanceof SpotLight||o instanceof DirectionalLight)o.shadow.needsUpdate=true})
  renderer.setRenderTarget(target); renderer.render(scene,camera)
  const pixels=new Uint8Array(512*512*4);renderer.readRenderTargetPixels(target,0,0,512,512,pixels)
  return pixels
}
function compare(light:PointLight|SpotLight|DirectionalLight, curved=false) {
  scene.add(light);light.castShadow=true;light.shadow.mapSize.set(256,256);light.shadow.bias=-.00001;light.shadow.normalBias=0;light.shadow.radius=1
  mesh.geometry=curved?sphere:plane;mesh.rotation.x=curved?0:-Math.PI/2
  camera.position.set(0,curved?0:8,curved?4:.01);camera.lookAt(0,0,0);camera.updateMatrixWorld();scene.updateMatrixWorld(true)
  const result:Record<string,{samples:number;affected:number;worst:number;mean:number}>={}
  for(const [name,material]of [['legacy',legacy],['fixed',corrected]]as const){
    mesh.material=material
    const actual=render(true), reference=render(false);mesh.castShadow=true
    let samples=0,affected=0,worst=1,total=0
    for(let y=8;y<504;y+=3)for(let x=8;x<504;x+=3){
      const offset=(y*512+x)*4,brightness=reference[offset]+reference[offset+1]+reference[offset+2]
      if(brightness<30)continue
      ray.setFromCamera({x:(x+.5)/256-1,y:(y+.5)/256-1}as never,camera)
      const hit=ray.intersectObject(mesh)[0];if(!hit)continue
      if(curved){
        const origin=hit.point.clone().addScaledVector(hit.face!.normal,.0002),direction=light.position.clone().sub(origin),distance=direction.length()
        const blocker=new Raycaster(origin,direction.multiplyScalar(1/distance),.0001,distance-.001).intersectObject(mesh)[0]
        if(blocker)continue
      }
      const ratio=(actual[offset]+actual[offset+1]+actual[offset+2])/brightness
      samples++;total+=ratio;worst=Math.min(worst,ratio);if(ratio<.95)affected++
    }
    result[name]={samples,affected,worst,mean:total/samples}
  }
  scene.remove(light);light.shadow.dispose();return result
}
const point=new PointLight('white',100,30,2);point.position.set(0,.08,0)
const spot=new SpotLight('white',100,30,Math.PI/3,0,2);spot.position.set(0,.08,0);spot.target.position.set(4,0,0);scene.add(spot.target)
const sun=new DirectionalLight('white',10);sun.position.set(0,.6,-5);sun.target.position.set(0,0,0);scene.add(sun.target)
Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.01,far:30})
const curved=new PointLight('white',8,30,2);curved.position.set(2,1,2)
const result={point:compare(point),spot:compare(spot),sun:compare(sun),curved:compare(curved,true)}
Object.assign(window,{localShadowResult:result})
renderer.setRenderTarget(null);renderer.render(scene,camera)
