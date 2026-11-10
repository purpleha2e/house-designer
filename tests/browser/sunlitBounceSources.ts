import {Box3,CubeCamera,DataTexture,DataUtils,DirectionalLight,HalfFloatType,LessEqualDepth,Mesh,MeshBasicMaterial,MeshStandardMaterial,NearestFilter,NoColorSpace,OrthographicCamera,PlaneGeometry,RGBAFormat,Scene,ShaderMaterial,Vector3,WebGLCubeRenderTarget,WebGLRenderTarget} from 'three'
import {includeViewportObject} from '../../src/viewportSurfaceVisibility'
import {indirectGeometryRanges,snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {serializeIndirectField} from '../../src/indirectLighting'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'

export async function sunlitSources(s:any){
 if(!new URLSearchParams(location.search).has('sunlit-bounce'))throw Error('Diagnostic flag required')
 const active=s.internal.active,loop=s.frameloop;s.setFrameloop('never');s.internal.active=false
 const field=s.scene.userData.getLightingField(),cache=s.scene.userData.getIndirectSurfaceCache(),u=s.scene.userData.getIndirectUniforms(),gl=s.gl,originalCoefficients=field.coefficients.map((a:Uint16Array)=>a.slice()),beforeTarget=gl.getRenderTarget(),auto=gl.autoClear
 const component=s.scene.userData.sunlitBedComponents;if(!component)throw Error('Run bedComponents first')
 const bed=s.scene.getObjectByProperty('uuid',component.mesh),duvet=component.components[0],duvetSet=new Set(duvet.triangles)
 if(duvet.triangles.length!==3020)throw Error('Unexpected duvet topology')
 const selected:any[]=[],a=new Vector3(),b=new Vector3(),c=new Vector3(),center=new Vector3(),normal=new Vector3(),roomCenter=new Vector3(1.3,3.8,12.3)
 s.scene.traverse((mesh:any)=>{
  if(!(mesh instanceof Mesh)||!includeViewportObject(mesh))return
  const g=mesh.geometry,ix=g.index,p=g.attributes.position;if(!p)return
  const categories=new Uint8Array((ix?.count??p.count)/3),role=String(mesh.userData.houseDesignerRole??''),wall=/wall-engine-render|roof-infill/.test(role)
  if(mesh!==bed&&!wall)return
  for(const range of indirectGeometryRanges(mesh))for(let i=range.start;i<range.start+range.count;i+=3){
   if(mesh===bed){if(duvetSet.has(i/3))categories[i/3]=1;continue}
   a.fromBufferAttribute(p,ix?.getX(i)??i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,ix?.getX(i+1)??i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,ix?.getX(i+2)??i+2).applyMatrix4(mesh.matrixWorld)
   center.copy(a).add(b).add(c).multiplyScalar(1/3);normal.subVectors(b,a).cross(c.clone().sub(a)).normalize()
   // Only vertical, room-facing opaque wall triangles belonging to this room.
   if(center.x>=-.5&&center.x<=3.15&&center.z>=10.25&&center.z<=14.55&&center.y>2.7&&center.y<5.15&&Math.abs(normal.y)<.15&&normal.dot(roomCenter.clone().sub(center))>0)categories[i/3]=2
  }
  if(categories.some(x=>x)){mesh.userData.sunlitCategories=categories;selected.push({mesh,categories})}
 })
 const {width,height,size}=cache.layout,mask=new WebGLRenderTarget(width,height,{type:HalfFloatType,format:RGBAFormat,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:true}),maskScene=new Scene(),owned:any[]=[]
 mask.depthTexture=cache.target.depthTexture
 for(const {mesh,categories}of selected)for(const category of [1,2]){
  const indices=[];for(let t=0;t<categories.length;t++)if(categories[t]===category)for(let k=0;k<3;k++)indices.push(mesh.geometry.index?.getX(t*3+k)??t*3+k)
  if(!indices.length)continue
  const geometry=mesh.geometry.clone();geometry.setIndex(indices);geometry.clearGroups()
  const original=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material)as MeshStandardMaterial,material=new MeshBasicMaterial({color:category===1?0xff0000:0x00ff00,side:original.side,depthFunc:LessEqualDepth,depthWrite:false,toneMapped:false})
  material.polygonOffset=original.polygonOffset;material.polygonOffsetFactor=original.polygonOffsetFactor;material.polygonOffsetUnits=original.polygonOffsetUnits
  const proxy=new Mesh(geometry,material);proxy.matrixAutoUpdate=false;proxy.matrix.copy(mesh.matrixWorld);proxy.matrixWorld.copy(mesh.matrixWorld);proxy.frustumCulled=false;maskScene.add(proxy);owned.push(geometry,material)
 }
 const cube=new WebGLCubeRenderTarget(size),camera=new CubeCamera(.03,80,cube);camera.coordinateSystem=gl.coordinateSystem;camera.updateCoordinateSystem()
 const clear=gl.getClearColor(new (await import('three')).Color()),clearAlpha=gl.getClearAlpha(),start=performance.now()
 try{
  gl.autoClear=false;gl.setClearColor(0,0);mask.scissorTest=false;gl.setRenderTarget(mask);gl.clear(true,false,false);mask.scissorTest=true
  for(const p of field.probes){
   camera.position.copy(p.position);for(const child of camera.children){(child as any).near=cache.captureNear(p.index);(child as any).updateProjectionMatrix()}camera.updateMatrixWorld(true)
   for(let face=0;face<6;face++){const [x,y]=cache.layout.tile(p.index,face);mask.viewport.set(x,y,size,size);mask.scissor.set(x,y,size,size);gl.setRenderTarget(mask);gl.render(maskScene,camera.children[face])}
   if(p.index%20===0)await new Promise(requestAnimationFrame)
  }
 }finally{gl.setRenderTarget(beforeTarget);gl.autoClear=auto;gl.setClearColor(clear,clearAlpha)}
 const read=async(target:any,index=0)=>{const C=target.textures[index].type===1015?Float32Array:Uint16Array,data=new C(width*height*4);await gl.readRenderTargetPixelsAsync(target,0,0,width,height,data,0,index);return data}
 const maskData=await read(mask),baseline=await read(cache.currentRadiance),staticRadiance=await read(cache.radiance),solar=new Uint16Array(width*height*4),reduce=new WebGLRenderTarget(4,1,{type:HalfFloatType,depthBuffer:false}),render=gl.render
 let solarMaterial:any,oldFragment='',oldKey:any
 let sun:any;s.scene.traverse((o:any)=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')sun=o})
 gl.render=function(scene:any,camera:any){const m=scene.children.find((o:any)=>o.material?.uniforms?.hdSunColor)?.material
  if(m&&!solarMaterial){solarMaterial=m;oldFragment=m.fragmentShader;oldKey=m.customProgramCacheKey;m.fragmentShader=m.fragmentShader.replace('vec4(hdSkyRadiance(normalize(direction),hdSkyRadianceBase), 0.0)','vec4(0.0)').replace('max(base + after - before + hdSunRadiance(p, n, viewDir, material), vec3(0.0))','hdSunRadiance(p, n, viewDir, material)');m.customProgramCacheKey=()=>oldKey.call(m)+':sunlit-solar-only';m.needsUpdate=true}
  const result=render.call(this,scene,camera)
  if(m){const f=m.uniforms.hdSurfaceFace.value,[x,y]=m.uniforms.hdSurfaceOrigin.value.toArray(),data=new Uint16Array(size*size*4),target=gl.getRenderTarget();gl.setRenderTarget(null);gl.readRenderTargetPixels(target,0,0,size,size,data,f);gl.setRenderTarget(target,f);for(let row=0;row<size;row++)solar.set(data.subarray(row*size*4,(row+1)*size*4),((y+row)*width+x)*4)}
  return result
 }
 try{for(const p of field.probes){cache.relightGPU(p.index,p.position.toArray(),[],reduce,0,sun,3.5);if(p.index%20===0)await new Promise(requestAnimationFrame)}}finally{gl.render=render;if(solarMaterial){solarMaterial.fragmentShader=oldFragment;solarMaterial.customProgramCacheKey=oldKey;solarMaterial.needsUpdate=true}reduce.dispose()}
 const cacheData={width,height,size,mask:maskData,baseline,staticRadiance,solar,receiver:await read(cache.target,1),normal:await read(cache.target,2),response:await read(cache.target,3),material:await read(cache.target,4),tiles:field.probes.map((p:any)=>({index:p.index,position:p.position.toArray(),faces:Array.from({length:6},(_,f)=>cache.layout.tile(p.index,f))}))}
 const check=()=>{if(!originalCoefficients.every((a:Uint16Array,i:number)=>a.every((v,j)=>v===field.coefficients[i][j])))throw Error('Authoritative field mutated')}
 const metadata={duvetComponent:duvet.id,duvetTriangles:duvet.triangles.length,selected:selected.map(({mesh,categories})=>({name:mesh.name,uuid:mesh.uuid,role:mesh.userData.houseDesignerRole,duvetTriangles:categories.filter((x:number)=>x===1).length,wallTriangles:categories.filter((x:number)=>x===2).length})),captureMs:performance.now()-start,maskPixels:[0,1].map(c=>Array.from(maskData).filter((v,i)=>i%4===c&&DataUtils.fromHalfFloat(v)>.5).length),solarPower:[0,1].map(c=>{let sum=0;for(let i=0;i<maskData.length;i+=4)sum+=DataUtils.fromHalfFloat(maskData[i+c])*DataUtils.fromHalfFloat(solar[i]);return sum})}
 s.scene.userData.sunlitSourceProgress=metadata
 const save=async(name:string,input:any)=>{const buffers:ArrayBuffer[]=[],header=new TextEncoder().encode(JSON.stringify(input,(_,v)=>{if(ArrayBuffer.isView(v)){const index=buffers.length;buffers.push(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)as ArrayBuffer);return{typed:v.constructor.name,index,length:(v as any).length}}return v})),blob=new Blob([new Uint32Array([header.length]),header,...buffers]),body=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();const response=await fetch('http://127.0.0.1:9187/save/'+name,{method:'POST',body});if(!response.ok)throw Error('Save failed');return body.size}
 await save('cache-sources.bin.gz',cacheData)
 check();mask.depthTexture=null;mask.dispose();cube.dispose();owned.forEach(o=>o.dispose())
 return{field,cache,u,cacheData,metadata,check,save,async snapshot(points:any[]){const snapshot=await snapshotReferenceScene(s,(mesh,triangle)=>mesh.userData.sunlitCategories?.[triangle]??0);const data={field:serializeIndirectField(field),coefficients:field.coefficients,geometry:snapshotIndirectGeometry(s.scene),reference:snapshot.data,points};const bytes=await save('scene-input.bin.gz',data);check();return{bytes,triangles:snapshot.triangles,materials:snapshot.materials}},dispose(){check();s.internal.active=active;s.setFrameloop(loop);s.invalidate()}}
}
