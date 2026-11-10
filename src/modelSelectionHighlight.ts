import { Group, Matrix4, Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three'
import { isBatchedModelSource } from './importedModelBatching.ts'
export function createSelectionHighlightMaterial() {
  const material = new MeshBasicMaterial({
    color: '#248cff', transparent: true, opacity: 0.28,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -1, toneMapped: false,
  })
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = diffuse;',
    )
  }
  return material
}

export function updateSelectionHighlightMaterial(material: MeshBasicMaterial, original: Material) {
  const textured = original as MeshBasicMaterial
  const map = original.alphaTest > 0 ? textured.map ?? null : null
  const alphaMap = textured.alphaMap ?? null
  if (material.side !== original.side || material.map !== map ||
    material.alphaMap !== alphaMap || material.alphaTest !== original.alphaTest ||
    material.clippingPlanes !== original.clippingPlanes ||
    material.clipIntersection !== original.clipIntersection) material.needsUpdate = true
  material.visible = original.visible && original.opacity > 0
  material.opacity = 0.28 * original.opacity
  material.map = map
  material.alphaMap = alphaMap
  material.alphaTest = original.alphaTest
  material.side = original.side
  material.clippingPlanes = original.clippingPlanes
  material.clipIntersection = original.clipIntersection
  material.clipShadows = original.clipShadows
}

/** Model-lifetime overlays borrow geometry. Sibling placement preserves batching
 * and lets batched parts highlight without changing authoritative visibility. */
export function createModelSelectionHighlight() {
  const root = new Group(), inverse = new Matrix4(), overlays = new Map<Mesh, Mesh>()
  const sourceMaterials = new Map<Mesh, Material[]>()
  root.name = 'model-selection-overlay'
  root.userData.selectionDecoration = true
  const release = (overlay: Mesh) => {
    overlay.removeFromParent()
    const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
    materials.forEach(material => material.dispose())
  }
  const dispose = () => { overlays.forEach(release); overlays.clear(); sourceMaterials.clear(); root.removeFromParent() }
  return { root, dispose, sync(object: Object3D | null, selected: boolean) {
    root.visible = selected
    if (!object) { dispose(); return }
    if (!selected) {
      // Hidden cached overlays must also release replaced assets. Inspect only
      // their leased sources; do not rescan every unselected model's subtree.
      overlays.forEach((overlay, source) => {
        let ancestor: Object3D | null = source
        while (ancestor && ancestor !== object) ancestor = ancestor.parent
        const materials = Array.isArray(source.material) ? source.material : [source.material]
        const previous = sourceMaterials.get(source)
        if (!ancestor || overlay.geometry !== source.geometry ||
          previous?.length !== materials.length || materials.some((m,i) => m !== previous[i])) {
          release(overlay); overlays.delete(source); sourceMaterials.delete(source)
        }
      })
      return
    }
    if (root.parent !== object) { dispose(); object.add(root) }
    object.updateWorldMatrix(true, true)
    inverse.copy(object.matrixWorld).invert()
    const sources = new Set<Mesh>()
    const visit = (node: Object3D) => {
      if (node.userData.selectionDecoration) return
      if (node instanceof Mesh) sources.add(node)
      node.children.forEach(visit)
    }
    visit(object)
    overlays.forEach((overlay, source) => {
      if (!sources.has(source)) { release(overlay); overlays.delete(source); sourceMaterials.delete(source) }
    })
    for (const source of sources) {
      const originals = Array.isArray(source.material) ? source.material : [source.material]
      let overlay = overlays.get(source)
      const existing = overlay && (Array.isArray(overlay.material) ? overlay.material : [overlay.material])
      if (overlay && (existing!.length !== originals.length ||
        Array.isArray(overlay.material) !== Array.isArray(source.material))) {
        release(overlay); overlays.delete(source); overlay = undefined
      }
      if (!overlay) {
        const highlights = originals.map(createSelectionHighlightMaterial)
        overlay = new Mesh(source.geometry, Array.isArray(source.material) ? highlights : highlights[0])
        overlay.name = 'model-selection-highlight'
        overlay.userData.selectionDecoration = true
        overlay.raycast = () => {}
        overlay.renderOrder = 5
        overlay.matrixAutoUpdate = false
        root.add(overlay); overlays.set(source, overlay)
      }
      let visible = true
      for (let ancestor: Object3D | null = source; ancestor && ancestor !== object; ancestor = ancestor.parent) {
        visible &&= ancestor.visible || isBatchedModelSource(ancestor)
      }
      overlay.visible = visible
      overlay.geometry = source.geometry
      overlay.matrix.multiplyMatrices(inverse, source.matrixWorld)
      overlay.matrixWorldNeedsUpdate = true
      overlay.layers.mask = source.layers.mask
      overlay.frustumCulled = source.frustumCulled
      const materials = (Array.isArray(overlay.material) ? overlay.material : [overlay.material]) as MeshBasicMaterial[]
      originals.forEach((original, index) => updateSelectionHighlightMaterial(materials[index], original))
      const previous = sourceMaterials.get(source)
      if (!previous || previous.length !== originals.length || originals.some((m,i) => m !== previous[i])) {
        sourceMaterials.set(source, [...originals])
      }
    }
  } }
}

