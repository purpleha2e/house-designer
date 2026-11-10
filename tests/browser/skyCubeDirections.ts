import {DataUtils,HalfFloatType,LinearSRGBColorSpace,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createDaylightSky,daylightSkyRadiance} from '../../src/daylightSky'

const renderer=new WebGLRenderer(),sky=createDaylightSky(16),direction=new Vector3(),sun=new Vector3(.5,.45,.4)
renderer.outputColorSpace=LinearSRGBColorSpace;renderer.setSize(8,8);document.body.appendChild(renderer.domElement)
const material=new ShaderMaterial({uniforms:{sky:{value:sky.texture},direction:{value:direction}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform samplerCube sky;uniform vec3 direction;void main(){gl_FragColor=textureCube(sky,direction);}'})
const scene=new Scene(),geometry=new PlaneGeometry(2,2),camera=new OrthographicCamera(-1,1,1,-1,0,1),target=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:false})
scene.add(new Mesh(geometry,material))
try{
  const rows=[]
  for(const mode of ['clear','overcast'] as const){
    sky.update(mode,1,sun)
    for(const d of [[1,.4,.2],[-1,.4,.2],[.2,.4,1],[.2,.4,-1],[1,-.4,.2],[.2,-.4,1],[0,1,0],[0,-1,0]]){
      direction.fromArray(d).normalize();renderer.setRenderTarget(target);renderer.render(scene,camera)
      const data=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,data)
      rows.push({mode,direction:direction.toArray(),actual:[...data.slice(0,3)].map(DataUtils.fromHalfFloat),expected:daylightSkyRadiance(direction,mode,1,sun).toArray()})
    }
  }
  Object.assign(window,{skyCubeDirections:{rows,glError:renderer.getContext().getError()}})
}finally{target.dispose();material.dispose();geometry.dispose();sky.dispose()}
