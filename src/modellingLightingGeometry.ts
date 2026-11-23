import { Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D, type Texture } from 'three'
import { includeViewportObject } from './viewportSurfaceVisibility.ts'

const shellRole = /^(?:wall-engine(?:-render)?|roof-(?:top|shell|eaves|soffit|underside|infill)|ceiling-(?:slab-(?:edge|solid|underside)|shadow-blocker)|slab-shadow-cap|room-(?:floor-(?:finish|base)|sloping-ceiling-finish|ceiling-(?:finish|shadow-blocker))|dormer-(?:walls|roof-top|roof-shell|soffit|ceiling|floor)|doorway-floor|portal-floor|ground-plane)$/
const helperRole = /(?:highlight|preview|pick|reference|fake-ambient|image|skybox)/

function excluded(object: Object3D) {
  const role = String(object.userData.houseDesignerRole ?? '')
  const generatedContainer = object.userData.modellingArchitectureContainer === true
  return (!generatedContainer && (object.name.startsWith('model-transform-') || object.userData.lightingModelId ||
    object.userData.indirectLightModel || object.userData.indirectStairModel)) || role === 'dormer-window' ||
    role === 'model-batch' || role === 'model-batches' || object.userData.selectionDecoration || helperRole.test(role)
}

/** Transport uses the actual generated building shell, including its cut-out
 * wall triangles. Imported furniture, window/door models and their render
 * batches remain ordinary receivers, but cannot block or colour this field. */
export function isModellingLightingArchitecture(object: Object3D): boolean {
  let structural = false
  for (let parent: Object3D | null = object; parent; parent = parent.parent) {
    const role = String(parent.userData.houseDesignerRole ?? '')
    if (excluded(parent)) return false
    structural ||= shellRole.test(role)
  }
  return structural
}

/** Small shell-only descriptor: catches worker geometry and finish texture
 * publications, without hashing or visiting the contents of imported models. */
export function modellingLightingArchitectureRevision(source: Object3D) {
  const parts: string[] = []
  const textureKey = (texture: Texture | null) => texture ? [texture.uuid, texture.version, texture.source.version] : null
  const visit = (object: Object3D) => {
    if (excluded(object)) return
    if (object instanceof Mesh && isModellingLightingArchitecture(object) && includeViewportObject(object)) {
      object.updateWorldMatrix(true, false)
      const geometry: BufferGeometry = object.geometry
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(material =>
        material instanceof MeshStandardMaterial ? [material.color.toArray(), material.emissive.toArray(), material.emissiveIntensity,
          material.roughness, material.metalness, material.opacity, material.alphaTest, material.side, material.colorWrite,
          textureKey(material.map), textureKey(material.alphaMap), textureKey(material.normalMap), textureKey(material.emissiveMap),
          material.clippingPlanes?.map(plane => [plane.normal.toArray(), plane.constant])] : [material.type, material.version])
      parts.push(JSON.stringify([geometry.uuid, Object.entries(geometry.attributes).map(([name, attribute]) =>
        [name, attribute.count, 'data' in attribute ? attribute.data.version : attribute.version]), geometry.index?.version,
      geometry.drawRange, geometry.groups, object.matrixWorld.elements.map(value => Math.round(value * 100000)), materials]))
    }
    object.children.forEach(visit)
  }
  visit(source)
  return parts.sort().join('|')
}
