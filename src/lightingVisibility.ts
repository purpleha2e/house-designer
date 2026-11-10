import { Material, MeshPhysicalMaterial } from 'three'

/** One coverage rule for ray queries, raster captures and shadow proxies.
 * Navigation fades are not glass; physical transmission is glass even without
 * an imported material name. Clear glazing is an opening approximation. */
export function isLightingGlazing(material:Material) {
  return material.userData.lightTransmission===true || /glass|glazing/i.test(material.name) ||
    material instanceof MeshPhysicalMaterial && material.transmission>0
}
