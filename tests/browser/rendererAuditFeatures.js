// Diagnostic-only final-GLSL bypasses in an owned audit fixture. Geometry,
// vertex shaders, viewport, render states and production sources stay intact.
import {ShaderChunk} from './rendererTestModules.ts'

export function installMainShaderFeatures(){
 const getContext=HTMLCanvasElement.prototype.getContext,contexts=[],stats={patched:0,normal:0,reflection:0,shadow:0,room:0,brdf:0,flat:0,packed:0,zeroLight:0}
 let feature=0,packedPrograms=new WeakSet()
 const patch=source=>{
  if(!/^#define SHADER_TYPE Mesh(?:Standard|Physical)Material$/m.test(source))return source
  source=source.replace(/precision\s+(?:highp|mediump|lowp)\s+int\s*;/,'$&\nuniform int hdAuditFeature;')
  const inject=(type,name,body,key)=>{const re=new RegExp('('+type+'\\s+'+name+'\\s*\\([^;{}]*\\)\\s*\\{)');if(re.test(source)){stats[key]++;source=source.replace(re,'$1\n'+body)}}
  const normal=ShaderChunk.normal_fragment_maps
  if(source.includes(normal)){stats.normal++;source=source.replace(normal,`if(hdAuditFeature!=1){\n${normal}\n}`)}
  inject('vec3','getIBLRadiance','if(hdAuditFeature==2)return vec3(0.0);','reflection')
  for(const name of ['getShadow','getPointShadow'])inject('float',name,'if(hdAuditFeature==3)return 1.0;','shadow')
  inject('float','hdRoomLightRoomAt','if(hdAuditFeature==4)return 0.0;','room')
  inject('float','hdRoomLightFactor','if(hdAuditFeature==4)return 1.0;','room')
  inject('vec3','BRDF_GGX','if(hdAuditFeature==5)return vec3(0.0);','brdf')
  const rough='float roughnessFactor = roughness;'
  if(source.includes(rough)){stats.flat++;source=source.replace(rough,`if(hdAuditFeature==8){gl_FragColor=vec4(vec3(.5),diffuseColor.a);return;}\n${rough}`)}
  const metal='vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );'
  if(source.includes(metal)){stats.packed++;source=source.replace(metal,`vec4 texelMetalness;\n#ifdef USE_ROUGHNESSMAP\nif(hdAuditFeature==6)texelMetalness=texelRoughness;else\n#endif\ntexelMetalness=texture2D(metalnessMap,vMetalnessMapUv);`)}
  inject('void','getPointLightInfo','if(hdAuditFeature==7&&all(equal(pointLight.color,vec3(0.0)))){light.direction=vec3(0.0,1.0,0.0);light.color=vec3(0.0);light.visible=false;return;}','zeroLight')
  inject('void','getSpotLightInfo','if(hdAuditFeature==7&&all(equal(spotLight.color,vec3(0.0)))){light.direction=vec3(0.0,1.0,0.0);light.color=vec3(0.0);light.visible=false;return;}','zeroLight')
  stats.patched++;return source
 }
 HTMLCanvasElement.prototype.getContext=function(type,...args){
  const g=getContext.call(this,type,...args);if(!g||type!=='webgl2'||g.__mainFeatureAudit)return g
  g.__mainFeatureAudit=true
  const shaderTypes=new WeakMap(),locations=new WeakMap(),last=new WeakMap(),restorers=[];let current
  const wrap=(key,fn)=>{const original=g[key];g[key]=fn(original);restorers.push(()=>g[key]=original)}
  wrap('createShader',fn=>function(type){const shader=fn.call(g,type);if(shader)shaderTypes.set(shader,type);return shader})
  wrap('shaderSource',fn=>function(shader,source){return fn.call(g,shader,shaderTypes.get(shader)===g.FRAGMENT_SHADER?patch(source):source)})
  wrap('linkProgram',fn=>function(program){locations.delete(program);last.delete(program);return fn.call(g,program)})
  wrap('useProgram',fn=>function(program){current=program;return fn.call(g,program)})
  const apply=()=>{if(!current)return;const code=feature===6&&!packedPrograms.has(current)?0:feature;if(last.get(current)===code)return;let location=locations.get(current);if(location===undefined){location=g.getUniformLocation(current,'hdAuditFeature');locations.set(current,location)}if(location!==null)g.uniform1i(location,code);last.set(current,code)}
  for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(key,fn=>function(...args){apply();return fn.apply(g,args)})
  contexts.push({g,restorers});return g
 }
 const api={stats,set(value){feature=value},get feature(){return feature},
  validatePacked(s){
   const programs=new Map(),materials=new Set();packedPrograms=new WeakSet()
   s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m)})
   const rows=[]
   for(const m of materials){const properties=s.gl.properties.get(m),p=properties.currentProgram;if(!p)continue;const eligible=!!m.roughnessMap&&m.roughnessMap===m.metalnessMap;let list=programs.get(p.program);if(!list)programs.set(p.program,list=[]);list.push(eligible);if(m.roughnessMap&&m.metalnessMap)rows.push({name:m.name,material:m.uuid,program:p.id,sameTexture:eligible,roughChannel:m.roughnessMap.channel,metalChannel:m.metalnessMap.channel})}
   for(const [program,list]of programs)if(list.every(Boolean))packedPrograms.add(program)
   return{materials:rows,eligiblePrograms:[...programs].filter(([,list])=>list.every(Boolean)).length}
  },restore(){feature=0},dispose(){feature=0;for(const {restorers}of contexts)for(const restore of restorers.reverse())restore();HTMLCanvasElement.prototype.getContext=getContext}}
 window.rendererMainFeatures=api;return api
}
