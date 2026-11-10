import { DataTexture, DataUtils, FloatType, HalfFloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry,
  RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { fastFilterFragment, fastFilterSigma } from '../../src/fastGIFilter'

/** Exercise the production filter on exact fields: preserve a constant and SH
 * direction, reduce sampling noise, and never cross a one-voxel partition. */
export async function checkFastGIFilter(renderer:WebGLRenderer) {
  const n=8,data=new Float32Array(n**3*4*4),source=new DataTexture(data,n*n,n*4,RGBAFormat,FloatType)
  source.minFilter=source.magFilter=NearestFilter
  const targets=[0,1].map(()=>new WebGLRenderTarget(n*n,n*4,{type:HalfFloatType,depthBuffer:false}))
  const material=new ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{n:{value:n},volumeMin:{value:new Vector3()},volumeSize:{value:new Vector3(2,2,2)},
    light:{value:source},axis:{value:new Vector3()},sigma:{value:fastFilterSigma},outputSize:{value:new Vector2(n*n,n*4)}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:fastFilterFragment})
  const geometry=new PlaneGeometry(2,2),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1)
  scene.add(new Mesh(geometry,material))
  const rt=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
  const run=async(kind:'constant'|'noise'|'partition')=>{
    const bands=[1,.5,-.25,.125]
    for(let band=0;band<4;band++)for(let y=0;y<n;y++)for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const index=(x+z*n+(y+band*n)*n*n)*4
      const value=kind==='constant'?1:kind==='noise'?(x+y+z)%2*2:x>4?4:0
      data[index]=data[index+1]=data[index+2]=value*bands[band]
      data[index+3]=band===0?(kind==='partition'&&x===4?1:0):band===1?.5:band===2?.25:.75
    }
    source.needsUpdate=true
    let input=source
    for(const [index,axis] of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].entries()){
      const destination=targets[index%2]
      material.uniforms.light.value=input;material.uniforms.axis.value.copy(axis)
      renderer.setRenderTarget(destination);renderer.render(scene,camera);input=destination.texture as typeof source
    }
    renderer.setRenderTarget(rt,face,mip)
    const pixels=new Uint16Array(data.length)
    await renderer.readRenderTargetPixelsAsync(targets[0],0,0,n*n,n*4,pixels)
    let mean=0,variance=0,leftMax=0,rightMin=Infinity,constantError=0,directionError=0,metadataError=0
    for(let y=0;y<n;y++)for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const index=(x+z*n+y*n*n)*4,value=DataUtils.fromHalfFloat(pixels[index])
      mean+=value;variance+=(value-1)**2
      if(x<4)leftMax=Math.max(leftMax,value);if(x>4)rightMin=Math.min(rightMin,value)
      constantError=Math.max(constantError,Math.abs(value-1))
      for(let band=0;band<4;band++){
        const offset=index+band*n**3*4
        directionError=Math.max(directionError,Math.abs(DataUtils.fromHalfFloat(pixels[offset])-value*bands[band]))
        metadataError=Math.max(metadataError,Math.abs(DataUtils.fromHalfFloat(pixels[offset+3])-data[offset+3]))
      }
    }
    return {mean:mean/n**3,variance:variance/n**3,leftMax,rightMin,constantError,directionError,metadataError}
  }
  try {return {constant:await run('constant'),noise:await run('noise'),partition:await run('partition')}}
  finally {renderer.setRenderTarget(rt,face,mip);source.dispose();targets.forEach(t=>t.dispose());material.dispose();geometry.dispose()}
}
