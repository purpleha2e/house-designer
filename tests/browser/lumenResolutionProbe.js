import {DataUtils, HalfFloatType, MeshBasicMaterial, Raycaster, Vector2, WebGLRenderTarget} from 'three'
import {linearToSRGB} from './lumenComposition.ts'

export function createLumenResolutionProbe(s, audit){
  const {gl:renderer,scene,camera}=s
  const context=renderer.getContext(), native=context.__rendererAudit
  const {composer,ao}=audit,pass=audit.lumenPass()
  const invalidate=()=>{scene.userData.displayEffectRevision++;s.invalidate()}
  const nativeTexture=texture=>{
    if(!texture?.isTexture)return null
    const handle=renderer.properties.get(texture).__webglTexture
    const info=handle&&native.textures.get(native.ids.get(handle))
    return {image:[texture.image?.width,texture.image?.height,texture.image?.depth??1],name:texture.name,
      internalFormat:texture.internalFormat,format:texture.format,type:texture.type,native:info,
      minFilter:texture.minFilter,magFilter:texture.magFilter,anisotropy:texture.anisotropy,mipmaps:texture.generateMipmaps,
      repeat:texture.repeat?.toArray(),colorSpace:texture.colorSpace}
  }
  const target=target=>({size:[target.width,target.height,target.depth],samples:target.samples,
    colors:target.textures.map(nativeTexture),depthTexture:nativeTexture(target.depthTexture),
    depthRenderbuffer:target.depthBuffer&&!target.depthTexture})
  const ownTargets=o=>Object.fromEntries(Object.entries(o).flatMap(([key,value])=>{
    if(value?.isWebGLRenderTarget)return [[key,target(value)]]
    if(Array.isArray(value)&&value.some(i=>i?.isWebGLRenderTarget))return [[key,value.filter(i=>i?.isWebGLRenderTarget).map(target)]]
    return []
  }))
  function floorMaterial(){
    const ray=new Raycaster()
    ray.setFromCamera(new Vector2(.53*2-1,1-.84*2),camera)
    const hit=ray.intersectObject(scene,true).find(hit=>hit.object.visible&&hit.object.userData.houseDesignerRole?.includes('floor'))
    if(!hit)return null
    const m=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material
    return {role:hit.object.userData.houseDesignerRole,material:m.name,roughness:m.roughness,metalness:m.metalness,
      normalScale:m.normalScale?.toArray(),uv:hit.uv?.toArray(),textures:Object.fromEntries(
        ['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(key=>[key,nativeTexture(m[key])]))}
  }
  function buffers(){
    const rect=renderer.domElement.getBoundingClientRect(),shadows=[]
    scene.traverse(object=>{if(object.shadow?.map)shadows.push({name:object.name||object.type,...target(object.shadow.map)})})
    const base=audit.snapshot()
    return {browser:{css:[rect.width,rect.height],window:[innerWidth,innerHeight],devicePixelRatio},
      drawingBuffer:[context.drawingBufferWidth,context.drawingBufferHeight],
      drawingBufferSamples:context.getContextAttributes()?.antialias,threePixelRatio:renderer.getPixelRatio(),
      viewportMode:scene.userData.modellingDisplay,composer:ownTargets(composer),
      passes:Object.fromEntries(composer.passes.map(pass=>[pass.name||pass.constructor.name,ownTargets(pass)])),
      sharedDepth:nativeTexture(pass.displayMaterial.uniforms.sceneDepth.value),
      floorDetail:pass.floorDetail&&{active:pass.displayMaterial.uniforms.hasFloorDetail.value, target:target(pass.floorDetail.target),
        sources:pass.floorDetail.floors.map(({source,proxy})=>({role:source.userData.houseDesignerRole,visible:source.visible,
          proxy:proxy.visible,mapped:!!source.material?.map,channel:source.material?.map?.channel,metalness:source.material?.metalness,
          metalnessMap:!!source.material?.metalnessMap,transparent:source.material?.transparent,wireframe:source.material?.wireframe}))},
      cacheTextures:Object.fromEntries(['cells','surfacePoint','surfaceNormal','surfaceAlbedo','supportLo','supportHi','distanceField']
        .map(key=>[key,nativeTexture(pass.displayMaterial.uniforms[key].value)])),
      shadows,floor:floorMaterial(),renderbuffers:base.renderbuffers.filter(b=>!b.deletedAt),hardware:base.hardware}
  }
  async function image(target,gain=1,attachment=0){
    const {width,height}=target,type=target.textures[attachment].type
    const raw=type===HalfFloatType?new Uint16Array(width*height*4):new Uint8Array(width*height*4)
    await renderer.readRenderTargetPixelsAsync(target,0,0,width,height,raw,undefined,attachment)
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height)
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const to=(y*width+x)*4,from=((height-1-y)*width+x)*4
      for(let c=0;c<3;c++){
        const v=type===HalfFloatType?DataUtils.fromHalfFloat(raw[from+c]):raw[from+c]/255
        pixels.data[to+c]=255*linearToSRGB(Math.max(0,v*gain))
      }
      pixels.data[to+3]=255
    }
    ctx.putImageData(pixels,0,0)
    return canvas.toDataURL('image/png')
  }
  async function readNativeStages(){
    const {bounce,previous,resolve,resolveMaterial}=pass
    const spatial=bounce.clone(),renderTarget=renderer.getRenderTarget(),u=resolveMaterial.uniforms
    const reuse=u.reuse.value
    try{
      u.reuse.value=0
      resolve.render(renderer,bounce,spatial)
      const spatialOnly=await image(spatial)
      return {raw:await image(bounce),spatialOnly,history:await image(previous)}
    }finally{u.reuse.value=reuse;renderer.setRenderTarget(renderTarget);spatial.dispose()}
  }
  async function albedo(){
    const saved=[],materials=new Map(), oldTarget=renderer.getRenderTarget(), oldClear=renderer.autoClear
    const target=new WebGLRenderTarget(renderer.domElement.width,renderer.domElement.height,{type:HalfFloatType})
    const replacement=material=>{
      if(!material.color)return material
      if(!materials.has(material))materials.set(material,new MeshBasicMaterial({map:material.map,color:material.color,
        side:material.side,alphaMap:material.alphaMap,alphaTest:material.alphaTest,opacity:material.opacity,
        transparent:material.transparent,depthWrite:material.depthWrite,vertexColors:material.vertexColors,toneMapped:false}))
      return materials.get(material)
    }
    scene.traverseVisible(object=>{
      if(!object.isMesh)return
      saved.push([object,object.material])
      object.material=Array.isArray(object.material)?object.material.map(replacement):replacement(object.material)
    })
    let pixels
    try{
      renderer.setRenderTarget(target);renderer.autoClear=true;renderer.render(scene,camera)
      pixels=image(target)
    }finally{
      for(const [object,material] of saved)object.material=material
      renderer.setRenderTarget(oldTarget);renderer.autoClear=oldClear
    }
    try{return await pixels}finally{target.dispose();for(const material of materials.values())material.dispose()}
  }
  function overrideComposite({raw=false,cache=false}={}){
    const render=renderer.render,u=pass.displayMaterial.uniforms
    renderer.render=function(object,...args){
      if(object!==pass.scene)return render.call(this,object,...args)
      const saved={bounce:u.bounceTexture.value,mode:u.diagnostic.value}
      if(raw)u.bounceTexture.value=pass.bounce.texture
      // Cached sky is a display-only branch. Trace and cache steps still use Final lighting.
      u.diagnostic.value=cache?16:22
      try{return render.call(this,object,...args)}finally{u.bounceTexture.value=saved.bounce;u.diagnostic.value=saved.mode}
    }
    invalidate()
    return()=>{renderer.render=render;invalidate()}
  }
  function traceResolution(divisor,rays){
    if(![1,2,4].includes(divisor)||![1,2,4,16].includes(rays))throw Error('Invalid diagnostic trace resolution')
    const {width,height}=composer.inputBuffer
    const w=Math.ceil(width/divisor),h=Math.ceil(height/divisor)
    for(const target of [pass.bounce,pass.resolved,pass.alternate])target.setSize(w,h)
    pass.traceMaterial.uniforms.bounceRays.value=rays
    pass.resetHistory();invalidate()
    return {width:w,height:h,rays,potentialRaysPerFrame:w*h*rays,buffersBytes:w*h*3*2*8}
  }
  function samplePattern(value){
    pass.traceMaterial.uniforms.samplePattern.value=value;pass.resetHistory();invalidate()
  }
  async function traceWork(){
    const target=pass.bounce,{width,height}=target,raw=new Uint16Array(width*height*4)
    await renderer.readRenderTargetPixelsAsync(target,0,0,width,height,raw,undefined,1)
    let active=0
    for(let i=3;i<raw.length;i+=4)if(raw[i]!==0xbc00)active++
    return {activeTracePixels:active,launchedRays:active*pass.traceMaterial.uniforms.bounceRays.value}
  }
  return {buffers,readNativeStages,albedo,overrideComposite,traceResolution,samplePattern,traceWork,floorImage:()=>image(pass.floorDetail.target)}
}
