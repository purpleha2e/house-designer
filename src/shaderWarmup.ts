import { FrontSide, Group, Material, type Object3D, type Mesh, type Texture } from 'three'

type Renderable = Object3D & { material: Material | Material[] }

const fadeSources = new WeakMap<Material, Material>()
const shaderScalarFeatures = new Set(['type', 'precision', 'vertexShader', 'fragmentShader', 'glslVersion',
  'normalMapType', 'side', 'transparent', 'blending', 'premultipliedAlpha', 'alphaHash', 'alphaToCoverage',
  'fog', 'flatShading', 'wireframe', 'vertexColors', 'sizeAttenuation', 'toneMapped', 'dithering',
  'combine', 'depthPacking', 'index0AttributeName'])
const shaderThresholdFeatures = ['alphaTest', 'anisotropy', 'clearcoat', 'dispersion', 'iridescence', 'sheen', 'transmission']
export function registerShaderFadeSource(material: Material, source: Material) {
  fadeSources.set(material, source)
}

/** Bounds and transform handles mark their parent, not every child mesh. */
export function isSelectionDecoration(object: Object3D) {
  for (let parent: Object3D | null = object; parent; parent = parent.parent) {
    if (parent.userData.selectionDecoration || ('isTransformControls' in parent && parent.isTransformControls)) return true
  }
  return false
}

/** Track program features, not material/geometry instance IDs. Rebuilt walls
 * with equivalent finishes reuse the programs retained by the warmup snapshot. */
export function getShaderWarmupSceneRevision(scene: Object3D) {
  const entries = new Set<string>()
  // Shared finishes occur on hundreds of meshes. Inspect each material once
  // per scan, while still noticing changes made without a version increment.
  const materialKeys = new Map<Material, string>()
  const geometryKeys = new Map<Mesh['geometry'], string>()
  scene.traverse(object => {
    const source = object as Renderable
    if (!source.material || isSelectionDecoration(object)) return
    for (const attached of Array.isArray(source.material) ? source.material : [source.material]) {
      const material = fadeSources.get(attached) ?? attached
      let materialKey = materialKeys.get(material)
      if (materialKey === undefined) {
        const features = Object.entries(material).flatMap(([key, value]) => {
          if (['uuid', 'id', 'version', 'name', 'visible'].includes(key)) return []
          if (value?.isTexture) {
            const texture = value as Texture
            return [[key, texture.channel, texture.mapping, texture.colorSpace, texture.format,
              key === 'envMap' ? (texture.image as { height?: number } | undefined)?.height : undefined]]
          }
          if (key === 'defines' || key === 'extensions') return [[key, Object.entries(value ?? {}).sort()]]
          return shaderScalarFeatures.has(key) ? [[key, value]] : []
        })
        // These values enable shader branches only when crossing zero. Opacity,
        // roughness, intensity and other uniform edits reuse the same program.
        const values = material as unknown as Record<string, unknown>
        features.push(...shaderThresholdFeatures.map(key => [key, Number(values[key] ?? 0) > 0]))
        features.push(['clippingPlanes', material.clippingPlanes?.length ?? 0], ['clipIntersection', material.clipIntersection])
        features.sort(([a], [b]) => String(a).localeCompare(String(b)))
        materialKey = JSON.stringify([material.customProgramCacheKey(), features])
        materialKeys.set(material, materialKey)
      }
      const mesh = object as Mesh
      let geometryKey = geometryKeys.get(mesh.geometry)
      if (geometryKey === undefined) {
        geometryKey = JSON.stringify([
          mesh.geometry && Object.entries(mesh.geometry.attributes).map(([key, attribute]) => [key, attribute.itemSize]).sort(),
          mesh.geometry && Object.entries(mesh.geometry.morphAttributes).map(([key, values]) => [key, values.length]).sort(),
          mesh.geometry?.morphTargetsRelative,
        ])
        geometryKeys.set(mesh.geometry, geometryKey)
      }
      entries.add(JSON.stringify([object.type, materialKey, geometryKey,
        'isInstancedMesh' in object && !!object.isInstancedMesh,
        'isBatchedMesh' in object && !!object.isBatchedMesh,
        'instanceColor' in object && !!object.instanceColor,
        'morphTexture' in object && !!object.morphTexture]))
    }
  })
  return JSON.stringify([...entries].sort())
}

/** A retained snapshot keeps programs for temporarily hidden/removed batches.
 * Selecting a model can remove an instanced batch without requiring new shaders. */
export function shaderWarmupRevisionIsCovered(prepared: string, current: string) {
  if (prepared === current) return true
  try {
    const available = new Set(JSON.parse(prepared) as string[])
    return (JSON.parse(current) as string[]).every(entry => available.has(entry))
  } catch { return false }
}

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
  /** Stable helper prototypes, compiled even before anything is selected. */
  helpers?: Object3D[]
}) {
  const root = new Group()
  const materials = new Map<Material, Map<string, Material>>()
  const extraMaterials = new Set<Material>()
  const cloneMaterial = (source: Material, variant: 'original' | 'wall-fade' | 'roof-fade', features: string) => {
    let variants = materials.get(source)
    if (!variants) materials.set(source, variants = new Map())
    // compileAsync waits for currentProgram on each material. Reusing one clone
    // across geometry/instancing variants makes it wait only for the last one,
    // leaving other programs to stall the first real draw.
    const variantKey = variant + ':' + features
    const cached = variants.get(variantKey)
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
    variants.set(variantKey, material)
    return material
  }
  for (const sourceRoot of [scene, ...(options.helpers ?? [])]) {
    sourceRoot.updateMatrixWorld(true)
    sourceRoot.traverse(object => {
      const source = object as Renderable
      if (sourceRoot === scene && isSelectionDecoration(object)) return
      if (!source.material || !(source.material instanceof Material || Array.isArray(source.material))) return
      const role = object.userData.houseDesignerRole
      const mesh = object as Mesh
      const features = JSON.stringify([object.type,
        'isInstancedMesh' in object && !!object.isInstancedMesh,
        'isBatchedMesh' in object && !!object.isBatchedMesh,
        'isSkinnedMesh' in object && !!object.isSkinnedMesh,
        'instanceColor' in object && !!object.instanceColor,
        'morphTexture' in object && !!object.morphTexture,
        mesh.geometry && Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, attribute.itemSize]).sort(),
        mesh.geometry && Object.entries(mesh.geometry.morphAttributes).map(([name, attributes]) => [name, attributes.length]).sort(),
        mesh.geometry?.morphTargetsRelative])
      const variants: Array<'original' | 'wall-fade' | 'roof-fade'> = ['original']
      if (options.fadeWalls && role === 'wall-engine-render') variants.push('wall-fade')
      if (options.fadeRoofs && fadingRoofRoles.has(role)) variants.push('roof-fade')
      for (const variant of variants) {
        const proxy = source.clone(false) as Renderable
        proxy.matrix.copy(source.matrixWorld)
        proxy.matrixWorld.copy(source.matrixWorld)
        proxy.matrixAutoUpdate = false
        proxy.material = Array.isArray(source.material)
          ? source.material.map(material => cloneMaterial(material, variant, features))
          : cloneMaterial(source.material, variant, features)
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
  }
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
