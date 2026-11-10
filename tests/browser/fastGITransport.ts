import { DataTexture, DataUtils, FloatType, GLSL3, HalfFloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry,
  RGBAFormat, Scene, ShaderMaterial, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { fastGIRayCount, fastBounceFragment, fastGatherFragment, fastPackFragment } from '../../src/fastGIPasses'
import { Vector2 } from 'three'

/** Analytic transport fixture: a red emitting plane, a receiving cell and a
 * thin separating wall. Exercises the actual GPU gather, not a CPU facsimile. */
export async function checkFastGITransport(renderer:WebGLRenderer) {
  const n=8,source=new Float32Array(n**3*6*4),normals=source.slice(),responses=source.slice(),state=new Float32Array(n**3*4)
  const texture=(data:Float32Array,height:number)=>{const t=new DataTexture(data,n*n,height,RGBAFormat,FloatType);t.minFilter=t.magFilter=NearestFilter;t.needsUpdate=true;return t}
  const radiance=texture(source,n*6),normal=texture(normals,n*6),occupancy=texture(state,n)
  const response=texture(responses,n*6)
  const target=new WebGLRenderTarget(n*n,n,{count:4,type:HalfFloatType,depthBuffer:false}),geometry=new PlaneGeometry(2,2)
  const packed=new WebGLRenderTarget(n*n,n*4,{type:HalfFloatType,depthBuffer:false}),bounced=new WebGLRenderTarget(n*n,n*6,{type:HalfFloatType,depthBuffer:false})
  const rays=Array.from({length:fastGIRayCount},(_,i)=>{const y=1-2*(i+.5)/fastGIRayCount,a=i*2.3999632297,r=Math.sqrt(1-y*y);return new Vector3(Math.cos(a)*r,y,Math.sin(a)*r)})
  const material=new ShaderMaterial({glslVersion:GLSL3,depthTest:false,uniforms:{n:{value:n},volumeMin:{value:new Vector3()},volumeSize:{value:new Vector3(n,n,n)},
    rays:{value:rays},skyRadiance:{value:new Vector3()},surfaceRadiance:{value:radiance},surfaceNormal:{value:normal},occupancy:{value:occupancy}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:fastGatherFragment})
  const shared={n:{value:n},volumeMin:{value:new Vector3()},volumeSize:{value:new Vector3(n,n,n)}}
  const pack=new ShaderMaterial({depthTest:false,uniforms:{...shared,c0:{value:target.textures[0]},cx:{value:target.textures[1]},cy:{value:target.textures[2]},cz:{value:target.textures[3]},occupancy:{value:occupancy},outputSize:{value:new Vector2(n*n,n*4)}},vertexShader:material.vertexShader,fragmentShader:fastPackFragment})
  const bounce=new ShaderMaterial({depthTest:false,uniforms:{...shared,surfaceRadiance:{value:radiance},surfaceNormal:{value:normal},surfaceResponse:{value:response},light:{value:packed.texture}},vertexShader:material.vertexShader,fragmentShader:fastBounceFragment})
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),quad=new Mesh(geometry,material);scene.add(quad)
  const rt=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
  const sample=async(wall:'none'|'sealed'|'opening'|'sky-sealed'|'sky-opening'|'floor-bounce',facing=-1,albedo=0)=>{
    source.fill(0);normals.fill(0);responses.fill(0);state.fill(0)
    for(let y=0;y<n;y++)for(let z=0;z<n;z++){
      const index=(6+z*n+y*n*n)*4,bandIndex=index+n**3*4
      state[index]=1;state[index+1]=1;source[bandIndex]=4;source[bandIndex+3]=1;normals[bandIndex]=facing;normals[bandIndex+3]=1
      if(wall!=='none'&&!(wall==='opening'&&y>=1&&y<=6&&z>=1&&z<=6))state[(4+z*n+y*n*n)*4]=1
    }
    const sky=wall.startsWith('sky-')
    material.uniforms.skyRadiance.value.setScalar(sky?1:0)
    if(sky){
      source.fill(0);normals.fill(0);state.fill(0)
      for(let x=0;x<n;x++)for(let y=0;y<n;y++)for(let z=0;z<n;z++){
        const shell=x===0||x===n-1||y===0||y===n-1||z===0||z===n-1
        const opening=wall==='sky-opening'&&x===n-1&&y>=2&&y<=5&&z>=2&&z<=5
        if(shell&&!opening){
          const index=(x+z*n+y*n*n)*4;state[index]=1
          for(let band=0;band<6;band++){
            const axis=Math.floor(band/2),positive=band%2===0,coordinate=[x,y,z][axis]
            if(coordinate!==(positive?0:n-1))continue
            const lobe=index+band*n**3*4;source[lobe+3]=1;normals[lobe+axis]=positive?1:-1;normals[lobe+3]=1
            responses[lobe]=responses[lobe+1]=responses[lobe+2]=albedo/Math.PI;responses[lobe+3]=1
          }
        }
      }
    }
    if(wall==='floor-bounce'){
      source.fill(0);normals.fill(0);state.fill(0)
      for(let x=0;x<n;x++)for(let z=0;z<n;z++){
        const cell=(x+z*n)*4,lobe=cell+2*n**3*4;state[cell]=1
        if(x>=4&&x<=6&&z>=1&&z<=6){source[lobe]=source[lobe+1]=source[lobe+2]=4;source[lobe+3]=1;normals[lobe+1]=1;normals[lobe+3]=1}
      }
      for(let y=1;y<n;y++)for(let z=0;z<n;z++){
        const cell=(n-1+z*n+y*n*n)*4,lobe=cell+n**3*4;state[cell]=1
        source[lobe+3]=1;normals[lobe]=-1;normals[lobe+3]=1
        responses[lobe]=responses[lobe+1]=responses[lobe+2]=albedo/Math.PI;responses[lobe+3]=1
      }
    }
    radiance.needsUpdate=normal.needsUpdate=occupancy.needsUpdate=response.needsUpdate=true
    material.uniforms.surfaceRadiance.value=radiance;quad.material=material
    renderer.setRenderTarget(target);renderer.render(scene,camera)
    if(albedo>0){
      quad.material=pack;renderer.setRenderTarget(packed);renderer.render(scene,camera)
      quad.material=bounce;renderer.setRenderTarget(bounced);renderer.render(scene,camera)
      quad.material=material;material.uniforms.surfaceRadiance.value=bounced.texture;renderer.setRenderTarget(target);renderer.render(scene,camera)
    }
    renderer.setRenderTarget(rt,face,mip)
    const coefficients=[]
    for(let band=0;band<4;band++){
      const pixel=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,2+3*n,3,1,1,pixel,undefined,band);coefficients.push(DataUtils.fromHalfFloat(pixel[0]))
    }
    const irradiance=async(x:number,y:number,z:number,axis:number,sign:number)=>{
      const mean=new Uint16Array(4),directional=new Uint16Array(4)
      await renderer.readRenderTargetPixelsAsync(target,x+z*n,y,1,1,mean,undefined,0)
      await renderer.readRenderTargetPixelsAsync(target,x+z*n,y,1,1,directional,undefined,axis+1)
      return Math.max(0,DataUtils.fromHalfFloat(mean[0])*.282095+sign*DataUtils.fromHalfFloat(directional[0])*.488603)
    }
    return {energy:coefficients[0],front:Math.max(0,coefficients[0]*.282095+coefficients[1]*.488603),back:Math.max(0,coefficients[0]*.282095-coefficients[1]*.488603),
      ...(wall==='floor-bounce'?{floor:await irradiance(2,1,3,1,1),wall:await irradiance(6,2,3,0,-1)}:{})}
  }
  try {
    renderer.setRenderTarget(target);const pending=renderer.compileAsync(scene,camera);renderer.setRenderTarget(rt,face,mip);await pending
    return {sealed:await sample('sealed'),opening:await sample('opening'),clear:await sample('none'),backFacingEmitter:await sample('none',1),skySealed:await sample('sky-sealed'),skyOpening:await sample('sky-opening'),skyReflected:await sample('sky-opening',-1,.7),sealedReflected:await sample('sky-sealed',-1,.7),floorDirect:await sample('floor-bounce'),floorReflected:await sample('floor-bounce',-1,.7)}
  } finally {renderer.setRenderTarget(rt,face,mip);[radiance,normal,occupancy,response].forEach(t=>t.dispose());[target,packed,bounced].forEach(t=>t.dispose());geometry.dispose();[material,pack,bounce].forEach(m=>m.dispose())}
}
