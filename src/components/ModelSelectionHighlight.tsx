import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three'

const ignoreRaycast = () => {}

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

// Separate materials keep shared GLTF assets and their original appearance intact.
export function ModelSelectionHighlight({ object }: { object: RefObject<Object3D | null> }) {
  const overlays = useRef(new Map<Mesh, Mesh>())
  useEffect(() => {
    const entries = overlays.current
    return () => {
      entries.forEach(overlay => {
        overlay.removeFromParent()
        const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
        materials.forEach(material => material.dispose())
      })
      entries.clear()
    }
  }, [])

  useFrame(() => {
    const sources: Mesh[] = []
    const visit = (node: Object3D) => {
      if (node.userData.selectionDecoration) return
      if (node instanceof Mesh) sources.push(node)
      node.children.forEach(visit)
    }
    if (object.current) visit(object.current)
    const active = new Set(sources)
    overlays.current.forEach((overlay, source) => {
      if (active.has(source)) return
      overlay.removeFromParent()
      const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
      materials.forEach(material => material.dispose())
      overlays.current.delete(source)
    })
    sources.forEach(source => {
      const originals = Array.isArray(source.material) ? source.material : [source.material]
      let overlay = overlays.current.get(source)
      const existing = overlay && (Array.isArray(overlay.material) ? overlay.material : [overlay.material])
      if (overlay && existing && (existing.length !== originals.length ||
        Array.isArray(overlay.material) !== Array.isArray(source.material))) {
        overlay.removeFromParent()
        existing.forEach(material => material.dispose())
        overlays.current.delete(source)
        overlay = undefined
      }
      if (!overlay) {
        const highlights = originals.map(createSelectionHighlightMaterial)
        overlay = new Mesh(source.geometry, Array.isArray(source.material) ? highlights : highlights[0])
        overlay.name = 'model-selection-highlight'
        overlay.userData.selectionDecoration = true
        overlay.raycast = ignoreRaycast
        overlay.renderOrder = 5
        source.add(overlay)
        overlays.current.set(source, overlay)
      }
      overlay.geometry = source.geometry
      overlay.frustumCulled = source.frustumCulled
      const materials = (Array.isArray(overlay.material) ? overlay.material : [overlay.material]) as MeshBasicMaterial[]
      originals.forEach((original: Material, index) => {
        const material = materials[index]
        if (!material) return
        updateSelectionHighlightMaterial(material, original)
      })
    })
  })
  return null
}
