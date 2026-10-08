import { MeshStandardMaterial, type Material, type Texture } from 'three'

/** Keep the authored paint colour; reflected light supplies the satin sheen. */
export function applyWindowFrameFinish(material: Material, environmentMap: Texture | null, intensity: number) {
  if (!(material instanceof MeshStandardMaterial) ||
    !(material.name === 'Window frame' || /^painted_white_frame(?:\.\d+)?$/.test(material.name))) return false
  const changed = material.envMap !== environmentMap || material.metalness !== 0 ||
    material.roughness !== 0.38 || material.envMapIntensity !== intensity
  material.metalness = 0
  material.roughness = 0.38
  material.envMap = environmentMap
  material.envMapIntensity = intensity
  if (changed) material.needsUpdate = true
  return true
}
