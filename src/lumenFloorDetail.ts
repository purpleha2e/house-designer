import { Color, GLSL3, Matrix3, Mesh, MeshStandardMaterial, NearestFilter, PlaneGeometry, Scene, ShaderMaterial,
  WebGLRenderTarget, type Camera, type Texture, type WebGLRenderer } from 'three'

/** Preserve the receiver's authored floor finish at raster resolution. Only
 * mapped floor surfaces draw here. The main colour, shadows and depth remain
 * in the editor's existing material pass. */
export class LumenFloorDetail {
  readonly target = new WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter})
  readonly material = new ShaderMaterial({name:'LumenFloorAlbedo',glslVersion:GLSL3,toneMapped:false,
    depthTest:false,depthWrite:false,
    uniforms:{finishMap:{value:null},finishUV:{value:new Matrix3()},tint:{value:new Color()},sceneDepth:{value:null}},
    vertexShader:`out vec2 floorUV;
      void main(){floorUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`in vec2 floorUV;out vec4 colour;
      uniform sampler2D finishMap,sceneDepth;uniform mat3 finishUV;uniform vec3 tint;
      void main(){
        vec2 uv=(finishUV*vec3(floorUV,1.)).xy;
        vec3 rho=texture(finishMap,uv).rgb*tint;
        float depth=texelFetch(sceneDepth,ivec2(gl_FragCoord.xy),0).r;
        if(abs(gl_FragCoord.z-depth)>0.0000004)discard;
        colour=vec4(rho,1.);
      }`})
  // The startup warm-up uses the same geometry attributes as the floor draws.
  readonly _mesh = new Mesh(new PlaneGeometry(),this.material)
  private readonly scene = new Scene()
  private floors: {source:Mesh;proxy:Mesh}[] = []
  private readonly clear = new Float32Array(4)

  setFloors(floors:Mesh[]) {
    this.reset()
    for(const source of floors){
      const proxy=new Mesh(source.geometry,this.material)
      proxy.matrixAutoUpdate=false
      proxy.onBeforeRender=()=>{
        const m=source.material as MeshStandardMaterial,map=m.map!
        if(map.matrixAutoUpdate)map.updateMatrix()
        const u=this.material.uniforms
        u.finishMap.value=map;u.finishUV.value.copy(map.matrix);u.tint.value.copy(m.color).multiplyScalar(1-m.metalness)
        this.material.uniformsNeedUpdate=true
      }
      this.floors.push({source,proxy});this.scene.add(proxy)
    }
  }

  render(renderer:WebGLRenderer,camera:Camera,depth:Texture,width:number,height:number) {
    let any=false
    for(const {source,proxy} of this.floors){
      const m=source.material
      proxy.visible=m instanceof MeshStandardMaterial && !!m.map && !m.map.channel && !m.wireframe && !m.transparent &&
        (!m.metalness || !m.metalnessMap) && m.visible && source.layers.test(camera.layers)
      // The display may temporarily hide a source while drawing an equivalent
      // batch. The full-resolution depth rejects floors hidden by the camera.
      for(let parent=source.parent;parent&&proxy.visible;parent=parent.parent)proxy.visible=parent.visible
      if(!proxy.visible)continue
      proxy.geometry=source.geometry;proxy.matrix.copy(source.matrixWorld);proxy.matrixWorldNeedsUpdate=true;any=true
    }
    if(!any)return false
    this.target.setSize(width,height)
    this.material.uniforms.sceneDepth.value=depth
    const autoClear=renderer.autoClear
    try{
      renderer.autoClear=false
      renderer.setRenderTarget(this.target)
      const gl=renderer.getContext() as WebGL2RenderingContext
      gl.clearBufferfv(gl.COLOR,0,this.clear)
      renderer.render(this.scene,camera)
    }finally{renderer.autoClear=autoClear}
    return true
  }

  reset(){this.scene.clear();this.floors=[];this.target.setSize(1,1)}
  dispose(){this.reset();this.target.dispose();this.material.dispose();this._mesh.geometry.dispose()}
}
