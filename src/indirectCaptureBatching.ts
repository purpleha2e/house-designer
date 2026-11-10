import {ShaderLib,type Material,type Texture,type WebGLRenderer} from 'three'

/** Uniform values as well as program features must agree before sharing a
 * capture material. In particular, equal variation programs can have different
 * paint colours, textures, scales or noise strengths. */
export function indirectCaptureMaterialKey(material:Material){
  const value=(v:unknown):unknown=>{
    if(v&&typeof v==='object'){
      if('isTexture' in v)return (v as Texture).uuid
      if('toArray' in v&&typeof v.toArray==='function')return v.toArray()
      if(ArrayBuffer.isView(v))return Array.from(v as unknown as ArrayLike<number>)
      if(Array.isArray(v))return v.map(value)
    }
    return typeof v==='number'||typeof v==='boolean'||typeof v==='string'||v===null?v:undefined
  }
  try{
    const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader} as Parameters<Material['onBeforeCompile']>[0]
    material.onBeforeCompile(shader,{} as WebGLRenderer)
    const uniforms=Object.entries(shader.uniforms).filter(([key])=>!/^hd(GI|Sky|Diagnostic|LightingDiagnostic|Fast|RoomLight|PointLightRoomIds|SpotLightRoomIds)/.test(key)).map(([key,u])=>[key,value(u.value)]).sort()
    // UUID/version/name do not affect pixels. Source texture identity and every
    // enumerable scalar/vector material property do.
    const properties=Object.entries(material).filter(([key])=>!['uuid','id','name','version'].includes(key)).map(([key,v])=>[key,value(v)]).filter(([,v])=>v!==undefined).sort()
    if(uniforms.some(([,v])=>v===undefined))return material.uuid
    return JSON.stringify([material.customProgramCacheKey(),properties,uniforms,'defines' in material?material.defines:undefined,
      'defaultAttributeValues' in material?material.defaultAttributeValues:undefined])
  }catch{return material.uuid} // Unknown custom hooks remain separate.
}
