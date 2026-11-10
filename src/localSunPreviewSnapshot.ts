import {DataUtils,DirectionalLight,HalfFloatType,InstancedMesh,Matrix3,Matrix4,Mesh,MeshStandardMaterial,NormalBlending,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,VSMShadowMap,WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import {indirectGeometryRanges} from './indirectVisibility.ts'
import {isSelectionDecoration} from './shaderWarmup.ts'
import {hasViewportSurfaceVisibility} from './viewportSurfaceVisibility.ts'
import {isBatchedModelSource} from './importedModelBatching.ts'
import type {Texture} from 'three'
import type {LocalSunPreviewData} from './localSunPreview.ts'
import {LOCAL_SUN_PREVIEW_BUDGET} from './localSunPreview.ts'

/** Opt-in current-scene metadata. Original texture images are sampled on the GPU
 * so KTX2 and sRGB interpretation follow Three. Preview images are capped at
 * 256px per side and 16 MiB in total; nothing is persisted or sent to a server. */
export async function snapshotLocalSunPreview(s:RootState,cancelled:()=>boolean,report:(text:string)=>void):Promise<{data:LocalSunPreviewData;primaryVisibility:()=>Uint8Array}>{
  const meshes:{mesh:Mesh;ranges:ReturnType<typeof indirectGeometryRanges>}[]=[],textures:Texture[]=[],materials:LocalSunPreviewData['materials']=[],ids=new Map<MeshStandardMaterial,number>()
  const textureIndex=(map:Texture|null)=>{if(!map)return -1;let id=textures.findIndex(t=>t.source===map.source&&t.colorSpace===map.colorSpace&&t.flipY===map.flipY&&t.format===map.format&&t.type===map.type);if(id<0){id=textures.length;textures.push(map)}map.updateMatrix();return id}
  const sampling=(map:Texture|null)=>map?{matrix:map.matrix.toArray(),wrapS:map.wrapS,wrapT:map.wrapT}:undefined
  s.scene.updateMatrixWorld(true)
  s.scene.traverse(o=>{
    if(!(o instanceof Mesh)||isSelectionDecoration(o)||/model-batch|ground-image/.test(String(o.userData.houseDesignerRole)))return
    for(let p:typeof o|null=o;p;p=p.parent as typeof o|null)if(!p.visible&&!isBatchedModelSource(p)&&!hasViewportSurfaceVisibility(p))return
    const ranges=indirectGeometryRanges(o);if(ranges.length)meshes.push({mesh:o,ranges})
  })
  const triangles=meshes.reduce((n,{mesh,ranges})=>n+ranges.reduce((a,r)=>a+Math.floor(r.count/3),0)*(mesh instanceof InstancedMesh?mesh.count:1),0)
  if(triangles>2000000)throw Error('Preview is limited to two million triangles')
  const positions=new Float32Array(triangles*9),normals=new Float32Array(triangles*9),uvs=new Float32Array(triangles*6),materialIndices=new Uint16Array(triangles),owners=new Uint32Array(triangles)
  const viewBindings:{start:number;count:number;mesh:Mesh;material:MeshStandardMaterial}[]=[]
  const v=new Vector3(),matrix=new Matrix4(),local=new Matrix4(),normalMatrix=new Matrix3();let output=0,owner=0
  for(const {mesh,ranges}of meshes){
    if(cancelled())throw Error('cancelled')
    const g=mesh.geometry,entries=Array.isArray(mesh.material)?mesh.material:[mesh.material],groups=g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}]
    for(let instance=0;instance<(mesh instanceof InstancedMesh?mesh.count:1);instance++,owner++){
      matrix.copy(mesh.matrixWorld);if(mesh instanceof InstancedMesh){mesh.getMatrixAt(instance,local);matrix.multiply(local)}const mirrored=matrix.determinant()<0;normalMatrix.getNormalMatrix(matrix)
      for(const range of ranges){
        const group=groups.find(a=>a.start===range.start)!,m=entries[Array.isArray(mesh.material)?group.materialIndex??0:0] as MeshStandardMaterial
        viewBindings.push({start:output/3,count:Math.floor(range.count/3),mesh,material:m})
        let id=ids.get(m)
        if(id===undefined){
          id=materials.length;if(id>=65535)throw Error('Too many preview materials');ids.set(m,id)
          const map=textureIndex(m.map),alphaMap=m.alphaTest>0||m.transparent?textureIndex(m.alphaMap):-1,metalnessMap=m.metalness>0?textureIndex(m.metalnessMap):-1,channel=m.map?.channel??0
          const uvMismatch=(alphaMap>=0&&m.alphaMap!.channel!==channel)||(metalnessMap>=0&&m.metalnessMap!.channel!==channel)
          const unsupported=uvMismatch?'Separate UV channels':m.alphaHash||m.alphaToCoverage?'Stochastic alpha':m.blending!==NormalBlending?'Custom blending':m.vertexColors?'Vertex colours':mesh.morphTargetInfluences?.length?'Morph targets':Reflect.get(mesh,'isSkinnedMesh')?'Skinned geometry':undefined
          const shadowSide=(m.shadowSide??(s.gl.shadowMap.type===VSMShadowMap?m.side:m.side===2?2:1-m.side)) as 0|1|2
          materials.push({color:m.color.toArray(),metalness:m.metalness,map,matrix:m.map?.matrix.toArray()??[1,0,0,0,1,0,0,0,1],wrapS:m.map?.wrapS??1001,wrapT:m.map?.wrapT??1001,side:m.side as 0|1|2,shadowSide,flatShading:m.flatShading,opacity:m.opacity,opaquePipeline:!m.transparent&&m.blending===NormalBlending&&!m.alphaToCoverage,alphaTest:m.alphaTest,alphaMap,metalnessMap,alphaSampling:sampling(m.alphaMap),metalnessSampling:sampling(m.metalnessMap),transmission:Number(Reflect.get(m,'transmission')??0),vertexColors:m.vertexColors,unsupported})
        }
        const uv=g.attributes[m.map?.channel?`uv${m.map.channel}`:'uv']
        for(let triangle=range.start;triangle+2<range.start+range.count;triangle+=3){
          materialIndices[output/3]=id;owners[output/3]=owner
          for(let corner=0;corner<3;corner++){
            const j=mirrored&&corner?3-corner:corner,index=g.index?.getX(triangle+j)??triangle+j
            v.fromBufferAttribute(g.attributes.position,index).applyMatrix4(matrix).toArray(positions,output*3)
            if(g.attributes.normal)v.fromBufferAttribute(g.attributes.normal,index).applyNormalMatrix(normalMatrix).toArray(normals,output*3)
            uvs[output*2]=uv?.getX(index)??0;uvs[output*2+1]=uv?.getY(index)??0;output++
          }
        }
      }
    }
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  const maxSide=Math.min(LOCAL_SUN_PREVIEW_BUDGET.maxTextureSide,Math.max(1,Math.floor(Math.sqrt(LOCAL_SUN_PREVIEW_BUDGET.maxTextureBytes/Math.max(1,textures.length)/8))))
  const images:LocalSunPreviewData['textures']=[],quadScene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2)
  const material=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{source:{value:null as Texture|null}},vertexShader:'varying vec2 tUV;void main(){tUV=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 tUV;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,tUV);}'})
  quadScene.add(new Mesh(geometry,material));let bytes=0
  try{
    for(const texture of textures){
      if(cancelled())throw Error('cancelled')
      report(`Reading material ${images.length+1}/${textures.length}`)
      const image=texture.image as {width:number;height:number};if(!image?.width||!image.height)throw Error('A material texture has not loaded')
      const scale=Math.min(1,maxSide/Math.max(image.width,image.height)),width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale))
      bytes+=width*height*8;if(bytes>LOCAL_SUN_PREVIEW_BUDGET.maxTextureBytes)throw Error('Preview textures exceed 16 MiB')
      const target=new WebGLRenderTarget(width,height,{type:HalfFloatType,depthBuffer:false}),previous=s.gl.getRenderTarget()
      try{material.uniforms.source.value=texture;s.gl.setRenderTarget(target);s.gl.clear();s.gl.render(quadScene,camera);s.gl.setRenderTarget(previous)
        const pixels=new Uint16Array(width*height*4);await s.gl.readRenderTargetPixelsAsync(target,0,0,width,height,pixels)
        if(pixels.some(v=>!Number.isFinite(DataUtils.fromHalfFloat(v))))throw Error('Invalid preview texture')
        images.push({width,height,pixels})
      }finally{s.gl.setRenderTarget(previous);target.dispose()}
    }
  }finally{geometry.dispose();material.dispose()}
  const uniforms=s.scene.userData.getIndirectUniforms?.();if(!uniforms)throw Error('Room lighting is not available')
  let sun:DirectionalLight|undefined;s.scene.traverse(o=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')sun=o})
  const primaryVisibility=()=>{
    const visible=new Uint8Array(triangles)
    for(const binding of viewBindings){
      if(!binding.material.visible)continue
      let enabled=true
      for(let p:typeof binding.mesh|null=binding.mesh;p;p=p.parent as typeof binding.mesh|null)if(!p.visible&&!isBatchedModelSource(p)){enabled=false;break}
      if(enabled)visible.fill(1,binding.start,binding.start+binding.count)
    }
    return visible
  }
  return{data:{positions,normals,uvs,materialIndices,owners,materials,textures:images,sunDirection:sun?sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3())).normalize().toArray():[0,1,0],sunIrradiance:sun?sun.color.toArray().map(c=>c*sun!.intensity):[0,0,0],daylightGain:s.scene.userData.getBakedIndirectLighting?.()?.settings.daylightBounceStrength??uniforms.hdSkyRadianceBase.value.x/.65},primaryVisibility}
}
