import { Data3DTexture, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { exteriorSkyOcclusionGLSL } from '../../src/exteriorSkyOcclusion'

// A flat wall divides a coarse field into dark indoor and bright outdoor cells.
// Sampling along its facade must not blend the indoor cells into vertical bands.
const renderer = new WebGLRenderer(), target = new WebGLRenderTarget(128, 1)
const scene = new Scene(), camera = new OrthographicCamera(), pixels = new Uint8Array(128 * 4)
const n = 32, cell = .35, min = new Vector3(-5,-5,-5), size = new Vector3().setScalar((n-1)*cell)
const data = new Uint8Array(n*n*n*2*4), texture = new Data3DTexture(data,n,n,n*2)
texture.format = RGBAFormat; texture.minFilter = texture.magFilter = LinearFilter
const normal = new Vector3(), base = new Vector3()
const material = new ShaderMaterial({defines:{HD_EXTERIOR_SKY_OCCLUSION:1}, uniforms:{
  hdExteriorSkyField:{value:texture},hdExteriorSkyMin:{value:min},hdExteriorSkySize:{value:size},
  hdExteriorSkyDimensions:{value:new Vector3(n,n,n)},hdExteriorSkyCell:{value:cell},hdExteriorSkyStrength:{value:1},
  hdExteriorEaveMin:{value:new Vector2()},hdExteriorEaveSize:{value:new Vector2(1,1)},
  hdExteriorEaveDimensions:{value:new Vector2(1,1)},hdExteriorEaveHeight:{value:new Vector2(0,1)},hdExteriorEaveLayers:{value:0},hdExteriorEaveFilterWidth:{value:6},
  surfaceNormal:{value:normal},surfaceBase:{value:base},unfiltered:{value:false},
},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
fragmentShader:`varying vec2 vUv;uniform vec3 surfaceNormal,surfaceBase;uniform bool unfiltered;${exteriorSkyOcclusionGLSL}
void main(){vec3 p=surfaceBase+vec3(-surfaceNormal.z,0.,surfaceNormal.x)*(vUv.x-.5)*5.;vec3 a,b;
if(unfiltered)hdExteriorSkyRead(p+surfaceNormal*(hdExteriorSkyCell*dot(abs(surfaceNormal),vec3(1.))+.015),a,b);
else hdExteriorSkySample(p,surfaceNormal,a,b);gl_FragColor=vec4(a,1.);}`})
scene.add(new Mesh(new PlaneGeometry(2,2),material))
const results=[]
for(const angle of [0,.25,.5,.75,1,1.4,2.2])for(const phase of [0,.11,.23]) {
  normal.set(Math.cos(angle),0,Math.sin(angle));base.copy(normal).multiplyScalar(phase)
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const visible=(min.x+x*cell-base.x)*normal.x+(min.z+z*cell-base.z)*normal.z>.015?255:0
    for(const layer of [0,n]){const i=(x+n*(y+n*(z+layer)))*4;data[i]=data[i+1]=data[i+2]=visible;data[i+3]=255}
  }
  texture.needsUpdate=true;renderer.setRenderTarget(target);renderer.render(scene,camera)
  renderer.readRenderTargetPixels(target,0,0,128,1,pixels)
  results.push({angle,phase,min:Math.min(...pixels.filter((_,i)=>i%4!==3))})
}
// A noisy coarse field should be softened along the facade, while the exposed
// half-space cases above remain fully lit rather than leaking across the wall.
normal.set(0,0,1);base.set(0,0,0)
for(let z=0;z<n*2;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
  const i=(x+n*(y+n*z))*4,value=x%2?255:80
  data[i]=data[i+1]=data[i+2]=value;data[i+3]=255
}
texture.needsUpdate=true
const deviations=[true,false].map(unfiltered=>{
  material.uniforms.unfiltered.value=unfiltered;renderer.render(scene,camera)
  renderer.readRenderTargetPixels(target,0,0,128,1,pixels)
  const values=Array.from({length:128},(_,i)=>pixels[i*4]),mean=values.reduce((a,b)=>a+b,0)/128
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/128)
})
Object.assign(window,{exteriorSamplingResults:results,exteriorSamplingNoise:{before:deviations[0],after:deviations[1]}})
texture.dispose();material.dispose();target.dispose();renderer.dispose()
