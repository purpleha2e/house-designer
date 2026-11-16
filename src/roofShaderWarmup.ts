import { BackSide, BoxGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshStandardMaterial, type Scene } from 'three'
import { applyIndirectLightingShader, enableExteriorSkyMaterial, getIndirectLightingUniforms } from './indirectLightingShader.ts'
import { applyRoomLightShader, getRoomLightUniforms } from './roomLightShader.ts'
import { applySpecularOnlyImageBasedLighting } from './materials/imageBasedLighting.ts'

/** Detached representatives of untextured roof finishes. Use the live lighting
 * bindings so startup prepares the same programs as a subsequently created roof.
 * Their dimensions and colours do not affect the compiled program. */
export function createRoofShaderWarmup(scene: Scene) {
  let room: ReturnType<typeof getRoomLightUniforms>
  let indirect: ReturnType<typeof getIndirectLightingUniforms>
  scene.traverse(object => {
    const mesh = object as Mesh
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue
      room ??= getRoomLightUniforms(material)
      indirect ??= getIndirectLightingUniforms(material)
    }
  })
  const root = new Group(), geometry = new BoxGeometry()
  const topGeometry = geometry.clone()
  topGeometry.setAttribute('hdGIExteriorReceiver', new Float32BufferAttribute(
    new Float32Array(topGeometry.attributes.position.count).fill(1), 1))
  const materials: MeshStandardMaterial[] = []
  for (const [role, shape, side] of [
    ['roof-top', topGeometry, FrontSide],
    ['roof-shell', geometry, FrontSide],
    ['roof-eaves', geometry, DoubleSide],
  ] as const) {
    const material = new MeshStandardMaterial({ side, shadowSide: role === 'roof-top' ? DoubleSide : BackSide })
    if (room) applyRoomLightShader(material, room)
    if (indirect) {
      applySpecularOnlyImageBasedLighting(material)
      applyIndirectLightingShader(material, indirect)
      if (indirect.hdExteriorSkyFeature.value > .5) enableExteriorSkyMaterial(material)
    }
    const mesh = new Mesh(shape, material)
    mesh.userData.houseDesignerRole = role
    mesh.castShadow = role !== 'roof-eaves'
    mesh.receiveShadow = role === 'roof-top'
    root.add(mesh); materials.push(material)
    // New meshes can be scanned before the lighting controllers attach their
    // hooks. Prepare this short-lived standard-material variant as well.
    const unpatched = new MeshStandardMaterial({ side, shadowSide: material.shadowSide })
    const initial = new Mesh(shape, unpatched)
    initial.userData.houseDesignerRole = role
    initial.castShadow = mesh.castShadow
    initial.receiveShadow = mesh.receiveShadow
    root.add(initial); materials.push(unpatched)
  }
  return { root, dispose() { geometry.dispose(); topGeometry.dispose(); materials.forEach(material => material.dispose()); root.clear() } }
}
