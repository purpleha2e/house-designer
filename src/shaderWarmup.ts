import { FrontSide, Group, Material, type Object3D } from 'three'

type Renderable = Object3D & { material: Material | Material[] }

const fadingRoofRoles = new Set([
  'roof-top', 'roof-shell', 'roof-eaves', 'roof-soffit', 'roof-infill',
  'dormer-roof-top', 'dormer-roof-shell', 'dormer-soffit',
])

/** Own the materials while compileAsync polls them, even if an edit disposes
 * the live scene. Geometry/textures remain shared and are never disposed here.
 * Retaining this snapshot also keeps off-screen/fade programs in the GPU cache. */
export function createShaderWarmupSnapshot(scene: Object3D, options: {
  fadeWalls: boolean
  fadeRoofs: boolean
  createExtraMaterials?: (source: Material, object: Object3D) => Material[]
}) {
  const root = new Group()
  const materials = new Map<Material, Map<string, Material>>()
  const extraMaterials = new Set<Material>()
  const cloneMaterial = (source: Material, variant: 'original' | 'wall-fade' | 'roof-fade') => {
    let variants = materials.get(source)
    if (!variants) materials.set(source, variants = new Map())
    const cached = variants.get(variant)
    if (cached) return cached
    const material = source.clone()
    // Material.clone deliberately omits application shader hooks.
    material.onBeforeCompile = source.onBeforeCompile.bind(source)
    const cacheKey = source.customProgramCacheKey()
    material.customProgramCacheKey = () => cacheKey
    if (variant !== 'original') {
      material.transparent = true
      material.opacity = 0.5
      material.alphaHash = false
      material.depthWrite = false
      material.forceSinglePass = true
      if (variant === 'wall-fade') material.side = FrontSide
    }
    variants.set(variant, material)
    return material
  }
  scene.updateMatrixWorld(true)
  scene.traverse(object => {
    const source = object as Renderable
    if (!source.material || !(source.material instanceof Material || Array.isArray(source.material))) return
    const role = object.userData.houseDesignerRole
    const variants: Array<'original' | 'wall-fade' | 'roof-fade'> = ['original']
    if (options.fadeWalls && role === 'wall-engine-render') variants.push('wall-fade')
    if (options.fadeRoofs && fadingRoofRoles.has(role)) variants.push('roof-fade')
    for (const variant of variants) {
      const proxy = source.clone(false) as Renderable
      proxy.matrix.copy(source.matrixWorld)
      proxy.matrixWorld.copy(source.matrixWorld)
      proxy.matrixAutoUpdate = false
      proxy.material = Array.isArray(source.material)
        ? source.material.map(material => cloneMaterial(material, variant))
        : cloneMaterial(source.material, variant)
      root.add(proxy)
    }
    const extras = options.createExtraMaterials?.(Array.isArray(source.material) ? source.material[0] : source.material, object)
    if (extras?.length) {
      // Extra variants use the same geometry/transform without touching live materials.
      const originals = Array.isArray(source.material) ? source.material : [source.material]
      const highlightMaterials = originals.map((material, index) => index === 0 ? extras :
        options.createExtraMaterials?.(material, object) ?? [])
      for (let variant = 0; variant < extras.length; variant++) {
        const proxy = source.clone(false) as Renderable
        proxy.matrix.copy(source.matrixWorld)
        proxy.matrixWorld.copy(source.matrixWorld)
        proxy.matrixAutoUpdate = false
        proxy.visible = true
        const entries = highlightMaterials.map(variants => variants[variant])
        entries.forEach(material => extraMaterials.add(material))
        proxy.material = Array.isArray(source.material) ? entries : entries[0]
        root.add(proxy)
      }
    }
  })
  let disposed = false
  return {
    root,
    dispose() {
      if (disposed) return
      disposed = true
      materials.forEach(variants => variants.forEach(material => material.dispose()))
      extraMaterials.forEach(material => material.dispose())
      root.clear()
    },
  }
}
