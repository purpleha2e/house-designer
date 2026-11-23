import { BackSide, DataTexture, DoubleSide, EdgesGeometry, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Scene, type Texture } from 'three'
import type { SurfaceMaterialProduct } from '../types'
import { applyWallOpeningPreviewShader } from '../wallOpeningPreview'
import { isMaterialVariationActive, normalizeMaterialVariation } from './proceduralVariation'
import { createSurfaceFinishShader, updateSurfaceMaterialShader } from './surfaceMaterialShader'

/** Compile the distinct opaque surface finish programs already offered
 * by the library, using tiny map placeholders and the actual studio environment. */
export function createDesignSurfaceWarmup(scene: Scene, products: Iterable<SurfaceMaterialProduct>, environment: Texture | null) {
  const root = new Group()
  const geometry = new PlaneGeometry()
  const outlineGeometry = new EdgesGeometry(geometry)
  const sample = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
  const albedo = sample.clone()
  albedo.colorSpace = SRGBColorSpace
  const styles = new Set<string>()
  const outlines = [new LineBasicMaterial(), new LineBasicMaterial({ transparent: true })]
  const materials: (MeshStandardMaterial | LineBasicMaterial)[] = [...outlines]
  for (const material of outlines) root.add(new LineSegments(outlineGeometry, material))

  for (const { pbr } of products) {
    const variation = pbr.proceduralVariation
    const variationKey = isMaterialVariationActive(variation, false)
      ? JSON.stringify(normalizeMaterialVariation(variation)) : ''
    const reflectEnvironment = pbr.imageBasedLighting === true
    const maps = {
      map: pbr.baseColorTextureUrl ? albedo : null,
      normalMap: pbr.normalTextureUrl ? sample : null,
      roughnessMap: pbr.roughnessTextureUrl ? sample : null,
      metalnessMap: pbr.metalnessTextureUrl ? sample : null,
      aoMap: pbr.ambientOcclusionTextureUrl ? sample : null,
    }
    const style = JSON.stringify([Object.values(maps).map(Boolean), reflectEnvironment, variationKey])
    if (styles.has(style)) continue
    styles.add(style)
    for (const [role, side] of [
      ['room-floor-finish', FrontSide],
      ['room-ceiling-finish', BackSide],
      ['wall-engine-render', DoubleSide],
      ['roof-infill', FrontSide],
      ['roof-infill', BackSide],
    ] as const) {
      const wall = role === 'wall-engine-render'
      const material = new MeshStandardMaterial({ ...maps, side,
        envMap: reflectEnvironment ? environment : null })
      updateSurfaceMaterialShader(material, createSurfaceFinishShader(variationKey, reflectEnvironment, wall || role === 'roof-infill'))
      if (wall) applyWallOpeningPreviewShader(material, scene)
      const mesh = new Mesh(geometry, material)
      mesh.userData.houseDesignerRole = role
      mesh.receiveShadow = true
      root.add(mesh)
      materials.push(material)
    }
  }
  return { root, dispose() {
    materials.forEach(material => material.dispose())
    outlineGeometry.dispose()
    geometry.dispose()
    albedo.dispose()
    sample.dispose()
    root.clear()
  } }
}
