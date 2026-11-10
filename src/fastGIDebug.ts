import { BufferAttribute, BufferGeometry, Color, GLSL3, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Points, Scene, ShaderMaterial, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three'
import type { createFastGI } from './fastGI.ts'

/** Explicit inspection may read back a small image; the GI update never does. */
export function createFastGIDebug(renderer:WebGLRenderer,engine:NonNullable<ReturnType<typeof createFastGI>>) {
  const target=new WebGLRenderTarget(512,512),scene=new Scene(),quadScene=new Scene(),geometry=new BufferGeometry()
  const n=engine.states[0].height,count=n**3*6
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(count*3),3))
  const material=new ShaderMaterial({glslVersion:GLSL3,uniforms:{radiance:{value:engine.surfaces.texture},normals:{value:engine.surfaces.textures[1]},
    occupancy:{value:engine.states[0].texture},light:{value:engine.lighting[0].texture},volumeMin:{value:new Vector3()},volumeSize:{value:new Vector3()},n:{value:n},mode:{value:0}},
    vertexShader:/* glsl */`
      uniform sampler2D radiance,normals,occupancy,light;
      uniform vec3 volumeMin,volumeSize; uniform float n; uniform int mode;
      out vec3 colorValue;
      void main(){
        float id=float(gl_VertexID),cell=mod(id,n*n*n),band=floor(id/(n*n*n));
        vec3 c=vec3(mod(cell,n),floor(cell/(n*n)),mod(floor(cell/n),n));
        vec2 uv=(vec2(c.x+c.z*n,c.y)+.5)/vec2(n*n,n),surfaceUV=vec2(uv.x,(uv.y+band)/6.0);
        vec4 sampleValue=texture(radiance,surfaceUV),normalValue=texture(normals,surfaceUV);
        vec3 status=texture(occupancy,uv).rgb;
        bool visible=sampleValue.a>.0;
        vec3 normalDirection=length(normalValue.xyz)>.0001?normalize(normalValue.xyz):vec3(0.0);
        colorValue=sampleValue.rgb/max(sampleValue.a,1.0);
        colorValue=pow(colorValue/(1.0+colorValue),vec3(1.0/2.2));
        if(mode==1)colorValue=normalDirection*.5+.5;
        if(mode==2){visible=band<.5&&status.r>.5;colorValue=status.g>.5?vec3(.1,1.0,.2):vec3(1.0,.1,.8);}
        if(mode==3){visible=band<.5&&status.r<.5&&status.b>.5;colorValue=vec3(.1,.6,1.0);}
        if(mode==4){visible=band<.5&&status.r<.5;vec3 v=texture(light,vec2(uv.x,uv.y*.25)).rgb*.282095;colorValue=pow(v/(1.0+v),vec3(1.0/2.2));}
        vec3 world=volumeMin+(c+.5+normalDirection*.2)/n*volumeSize;
        gl_Position=visible?projectionMatrix*viewMatrix*vec4(world,1.0):vec4(2.0,2.0,2.0,1.0);gl_PointSize=3.0;
      }`,fragmentShader:'in vec3 colorValue;out vec4 outputColor;void main(){outputColor=vec4(colorValue,1.0);}'})
  const points=new Points(geometry,material);points.frustumCulled=false;scene.add(points)
  const quadMaterial=new ShaderMaterial({depthTest:false,uniforms:{image:{value:engine.captures.texture},tile:{value:0}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:/* glsl */`
      uniform sampler2D image;uniform float tile;
      void main(){vec2 uv=(gl_FragCoord.xy/512.0+vec2(mod(tile,4.0),floor(tile/4.0)))/vec2(4.0,3.0);
        vec3 color=texture2D(image,uv).rgb;gl_FragColor=vec4(pow(color/(1.0+color),vec3(1.0/2.2)),1.0);}`})
  const quadGeometry=new PlaneGeometry(2,2);quadScene.add(new Mesh(quadGeometry,quadMaterial))
  const quadCamera=new OrthographicCamera(-1,1,1,-1,0,1),camera=new PerspectiveCamera(55,1,.01,1000)
  let panel:HTMLDivElement|null=null,busy=false
  return {
    async inspect(kind:'forward'|'reverse'|'surfaces'|'normals'|'occupancy'|'empty'|'radiance'|'indirect',view=0) {
      if(busy)throw Error('An inspection readback is already in progress')
      if(!engine.bounds)throw Error('No reconstruction yet')
      busy=true
      try {
        engine.bounds.getSize(material.uniforms.volumeSize.value);material.uniforms.volumeMin.value.copy(engine.bounds.min)
        material.uniforms.occupancy.value=engine.states[engine.bank].texture;material.uniforms.light.value=engine.lighting[engine.bank].texture
        material.uniforms.mode.value=kind==='normals'?1:kind==='occupancy'?2:kind==='empty'?3:kind==='indirect'?4:0
        const centre=engine.bounds.getCenter(new Vector3()),extent=engine.bounds.getSize(new Vector3()).length()
        camera.position.copy(centre).add(new Vector3(.7,.5,.8).multiplyScalar(extent));camera.lookAt(centre);camera.updateMatrixWorld()
        quadMaterial.uniforms.tile.value=Math.max(0,Math.min(5,view))*2+(kind==='reverse'?1:0)
        const rt=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),auto=renderer.autoClear
        const color=renderer.getClearColor(new Color()),alpha=renderer.getClearAlpha(),viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),test=renderer.getScissorTest()
        try { renderer.setRenderTarget(target);renderer.setClearColor(0x101820,1);renderer.autoClear=true
          renderer.render(kind==='forward'||kind==='reverse'?quadScene:scene,kind==='forward'||kind==='reverse'?quadCamera:camera)
        } finally {renderer.setClearColor(color,alpha);renderer.autoClear=auto;renderer.setRenderTarget(rt,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test)}
        const pixels=new Uint8Array(512*512*4)
        await renderer.readRenderTargetPixelsAsync(target,0,0,512,512,pixels)
        if(!panel){panel=document.createElement('div');panel.style.cssText='position:fixed;right:16px;top:16px;z-index:100000;background:#101820;color:white;padding:8px;font:12px monospace;max-width:80vw';document.body.append(panel)}
        panel.replaceChildren();const label=document.createElement('div');label.textContent=`Experimental GI: ${kind} · ${JSON.stringify(engine.stats)}`;label.style.maxWidth='512px';panel.append(label)
        const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{panel?.remove();panel=null};panel.append(close)
        const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.style.cssText='display:block;width:512px;max-width:75vw'
        const image=new ImageData(512,512);for(let y=0;y<512;y++)image.data.set(pixels.subarray((511-y)*512*4,(512-y)*512*4),y*512*4)
        canvas.getContext('2d')!.putImageData(image,0,0);panel.append(canvas)
        return canvas.toDataURL()
      } finally {busy=false}
    },
    dispose(){panel?.remove();target.dispose();geometry.dispose();material.dispose();quadMaterial.dispose();quadGeometry.dispose()},
  }
}
