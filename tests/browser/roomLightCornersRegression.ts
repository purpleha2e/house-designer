import { Mesh, MeshStandardMaterial, NoToneMapping, OrthographicCamera, PlaneGeometry, PointLight,
  Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createRoomLightMask } from '../../src/roomLightMask'
import { applyRoomLightShader, createRoomLightBoundaryTexture, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../../src/roomLightShader'

// Sample the production material at precise world positions. A 1-pixel target
// avoids screen-space edge ambiguity when comparing the wall and ceiling.
const renderer = new WebGLRenderer(); renderer.toneMapping = NoToneMapping
const target = new WebGLRenderTarget(1, 1), camera = new OrthographicCamera(-.001, .001, .001, -.001, .01, 10)
const scene = new Scene()
const mesh = new Mesh(new PlaneGeometry(.02, .02), new MeshStandardMaterial()), light = new PointLight('white', 3, 20, 0)
scene.add(mesh, light)
const results: unknown[] = []
for (const angle of [0, .37]) {
  mesh.material.dispose()
  const material = new MeshStandardMaterial({ color: 'white', roughness: 1 }); mesh.material = material
  const transform = (x: number, z: number) => ({ x: x * Math.cos(angle) - z * Math.sin(angle) + .017,
    y: x * Math.sin(angle) + z * Math.cos(angle) + .013 })
  const polygon = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 6], [0, 6]].map(([x, z]) => transform(x, z))
  const mask = createRoomLightMask([{ signature: 'hall', polygon }], { minX: -8, minZ: -8, size: 16 }, 64)
  const texture = createRoomLightMaskTexture(mask), boundaries = createRoomLightBoundaryTexture(mask)
  const uniforms = createRoomLightShaderUniforms(texture, boundaries)
  uniforms.enabled.value = 1; uniforms.maskBounds.value.set(-8, -8, 16, 16); uniforms.floorRange.value.set(0, 3)
  uniforms.pointRoomIds.value[0] = mask.roomIdsBySignature.get('hall')!
  const restore = applyRoomLightShader(material, uniforms)
  const source = transform(3, .5); light.position.set(source.x, 1.2, source.y)
  const sample = (x: number, z: number, ceiling: boolean, enabled = 1) => {
    const p = transform(x, z), normal = ceiling ? new Vector3(0, -1, 0) : new Vector3(Math.cos(angle), 0, Math.sin(angle))
    mesh.position.set(p.x, 2.4, p.y); mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
    camera.position.copy(mesh.position).add(normal); camera.up.set(0, 0, 1); camera.lookAt(mesh.position); camera.updateMatrixWorld()
    uniforms.enabled.value = enabled; renderer.setRenderTarget(target); renderer.render(scene, camera)
    const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    return pixel[0]
  }
  const checks = [
    { name: 'opposite wall lit to join', x: .001, z: 4.98, ceiling: false, lit: true },
    { name: 'opposite ceiling lit to join', x: .001, z: 4.98, ceiling: true, lit: true },
    { name: 'opposite wall shadow', x: .001, z: 5.02, ceiling: false, lit: false },
    { name: 'opposite ceiling shadow', x: .001, z: 5.02, ceiling: true, lit: false },
    { name: 'shadow attaches at casting corner', x: 1.998, z: 2.012, ceiling: true, lit: false },
    { name: 'lit beside casting corner', x: 1.998, z: 1.99, ceiling: true, lit: true },
    { name: 'wall endpoint does not self shadow', x: 0, z: 3, ceiling: false, lit: true },
  ].map(check => {
    const masked = sample(check.x, check.z, check.ceiling), reference = sample(check.x, check.z, check.ceiling, 0)
    if (reference < 10 || (check.lit ? Math.abs(masked - reference) > 1 : masked > 1)) {
      throw Error(`${angle}: ${check.name}: ${masked}/${reference}`)
    }
    return { ...check, masked, reference }
  })
  results.push({ angle, checks }); restore(); texture.dispose(); boundaries.dispose()
}
Object.assign(window, { roomLightCornerResult: results })
renderer.setRenderTarget(null); target.dispose(); renderer.dispose()
