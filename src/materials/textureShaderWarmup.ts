import { DataTexture, FrontSide, MeshStandardMaterial, SRGBColorSpace, type Material, type Object3D, type Texture } from 'three'
import type { SurfaceMaterialProduct } from '../types.ts'
import { getIndirectLightingUniforms } from '../indirectLightingShader.ts'

const slots = ['map','normalMap','roughnessMap','metalnessMap','aoMap'] as const
const urls = ['baseColorTextureUrl','normalTextureUrl','roughnessTextureUrl','metalnessTextureUrl','ambientOcclusionTextureUrl'] as const
const roles = new Set(['wall-engine-render','roof-top','roof-shell','roof-eaves','roof-soffit','roof-underside',
  'room-floor-base','room-floor-finish','room-ceiling-finish','room-sloping-ceiling-finish','ceiling-slab-solid','ceiling-slab-underside'])

/** Compile texture-slot combinations without downloading a material library.
 * One-pixel stand-ins select the same shader defines as the real maps. */
export function createTextureShaderWarmup(products: Iterable<SurfaceMaterialProduct>, reflectionEnvironment: Texture | null = null) {
  const masks = new Set([1,7]) // Albedo only; albedo + normal + roughness.
  for (const product of products) {
    const mask = urls.reduce((bits,url,index)=>product.pbr[url]?bits|(1<<index):bits,0)
    if(mask)masks.add(mask)
  }
  const color = new DataTexture(new Uint8Array([255,255,255,255]),1,1)
  color.colorSpace = SRGBColorSpace
  const data = new DataTexture(new Uint8Array([128,128,255,255]),1,1)
  return {
    materials(source: Material, object: Object3D, fadeWalls: boolean, fadeRoofs: boolean) {
      const role = object.userData.houseDesignerRole
      if (!(source instanceof MeshStandardMaterial) || !roles.has(role) || !getIndirectLightingUniforms(source)) return []
      const result: MeshStandardMaterial[] = []
      // Surface products opt into the provider's environment explicitly;
      // scene.environment is deliberately null. Texture slots alone therefore
      // do not cover reflective finishes such as locally imported slate.
      // Include paint (no maps), and borrow the provider's already uploaded
      // environment rather than creating/downloading another one.
      const environments = source.envMap ? [source.envMap] : [null, ...(reflectionEnvironment ? [reflectionEnvironment] : [])]
      for (const environment of environments) for (const mask of environment ? [0,...masks] : masks)
      for (const faded of [false,...((role==='wall-engine-render'?fadeWalls:role.startsWith('roof-')&&fadeRoofs)?[true]:[])]) {
        const material = source.clone()
        material.envMap = environment
        material.onBeforeCompile = source.onBeforeCompile.bind(source)
        const key = source.customProgramCacheKey(); material.customProgramCacheKey = () => key
        if ('defaultAttributeValues' in source) Object.assign(material,{defaultAttributeValues:source.defaultAttributeValues})
        slots.forEach((slot,index)=>{material[slot]=mask&(1<<index)?index===0?color:data:null})
        if(faded){material.transparent=true;material.opacity=.5;material.depthWrite=false;material.forceSinglePass=true;if(role==='wall-engine-render')material.side=FrontSide}
        result.push(material)
      }
      return result
    },
    dispose(){color.dispose();data.dispose()},
  }
}
