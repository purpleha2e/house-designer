import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three'
import { isLightingGlazing } from './lightingVisibility.ts'

const architecturalRoles = new Set(['wall-engine-render', 'roof-infill', 'roof-top', 'roof-shell', 'roof-eaves', 'roof-soffit', 'roof-underside',
  'ceiling-slab-solid', 'ceiling-slab-underside', 'slab-shadow-cap', 'room-floor-base', 'room-floor-finish', 'room-ceiling-finish', 'room-sloping-ceiling-finish'])

export const isExteriorSkyOccluder = (mesh: Mesh) => architecturalRoles.has(mesh.userData.houseDesignerRole)

const eaveRoles = new Set(['roof-top', 'roof-shell', 'roof-eaves', 'roof-soffit', 'roof-underside'])
export const isExteriorEaveOccluder = (mesh: Mesh) => eaveRoles.has(mesh.userData.houseDesignerRole)

/** Sources retain their materials when instanced; marking those materials
 * also shades the render batch without splitting it into more draw calls. */
export function isExteriorSkyReceiver(mesh: Mesh, material: Material) {
  if (!(material instanceof MeshStandardMaterial) || isLightingGlazing(material)) return false
  if (isExteriorSkyOccluder(mesh)) return true
  for (let object: Object3D | null = mesh; object; object = object.parent) {
    if (object.userData.exteriorSkyReceiver) return true
  }
  return false
}
