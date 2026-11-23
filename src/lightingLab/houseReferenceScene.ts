import { BufferAttribute, BufferGeometry, Color, DataTexture, DirectionalLight, DoubleSide,
  EquirectangularReflectionMapping, FloatType, Matrix4, Mesh, MeshPhysicalMaterial, PointLight,
  RGBAFormat, Scene, SpotLight, type MeshStandardMaterial, type Texture } from 'three'
import type { HouseInput, HouseSnapshot } from './houseBridge'
import { LAB_SKY_COLOUR, LAB_SKY_RADIANCE } from './calibration.ts'

/** Reconstruct the source scene directly. No lighting proxies, projection
 * charts, cached albedo, cached light, filtering, or fast-renderer shaders. */
export function createHouseReferenceScene(snapshot: HouseSnapshot, input: HouseInput, diffuse: boolean, useAuthoredGlazing = false) {
  const scene = new Scene(), textures = new Map<Texture, Texture>(), geometries: BufferGeometry[] = []
  const copyTexture = (source: Texture | null) => {
    if (!source) return null
    let copy = textures.get(source)
    if (!copy) { copy = source.clone(); copy.needsUpdate = true; textures.set(source, copy) }
    return copy
  }
  const materials: MeshStandardMaterial[] = snapshot.finishes.map(finish => {
    // Standard clear architectural panes. Imported display-glass tint/opacity
    // is not a physical absorption model. Keep frames and door leaves authored.
    if (snapshot.exterior && finish.glazing && !useAuthoredGlazing) return new MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, ior: 1.5, thickness: 0, roughness: 0, metalness: 0, side: DoubleSide })
    const source = finish.referenceMaterial
    const material = !diffuse && source ? source.clone() : new MeshPhysicalMaterial({ roughness: 1, metalness: 0, specularIntensity: 0 })
    material.color.fromArray(finish.colour); material.emissive.fromArray(finish.emission); material.emissiveIntensity = 1
    material.map = finish.map; material.alphaTest = finish.alphaTest
    // Raster face culling is not a physical hole. In particular, ceiling
    // finish planes must block shadow rays from either direction. The reference
    // library treats single-sided shadow visibility differently from path hits.
    material.side = DoubleSide
    material.envMap = null
    if (finish.daylightEmitter) { material.side = DoubleSide; if (!input.daylight) material.emissive.setRGB(0, 0, 0) }
    for (const key of Object.keys(material)) {
      const value = (material as unknown as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && 'isTexture' in value)
        (material as unknown as Record<string, unknown>)[key] = copyTexture(value as Texture)
    }
    return material
  })
  let triangles = 0, windowEmitterTriangles = 0
  for (const part of snapshot.parts) for (const elements of part.matrices) for (const range of part.ranges) {
    const matrix = new Matrix4().fromArray(elements), ids: number[] = []
    const finish = snapshot.finishes[range.material]
    const material = materials[range.material]
    for (let i = range.start; i < range.start + range.count; i++) ids.push(part.index?.[i] ?? i)
    if (finish.daylightEmitter) windowEmitterTriangles += range.count / 3
    if (!ids.length) continue
    // The path tracer stores material IDs per vertex. The editor may reuse
    // vertices across material groups (including opposite wall finishes).
    // Expand selected triangles so assigning one face cannot repaint another.
    const expand = (source: Float32Array, size: number) => {
      const values = new Float32Array(ids.length * size)
      ids.forEach((id, index) => values.set(source.subarray(id * size, id * size + size), index * size))
      return new BufferAttribute(values, size)
    }
    const geometry = new BufferGeometry().setAttribute('position', expand(part.position, 3))
    if (part.normal) geometry.setAttribute('normal', expand(part.normal, 3))
    if (part.uv) geometry.setAttribute('uv', expand(part.uv, 2))
    if (!part.normal) geometry.computeVertexNormals()
    // The reference generator creates one material group per mesh. Give it
    // single-material meshes so its merged face/material ordering stays exact.
    const mesh = new Mesh(geometry, material); mesh.name = part.name ?? ''; mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix)
    scene.add(mesh); geometries.push(geometry); triangles += ids.length / 3
  }
  const sky = new Float32Array(32 * 16 * 4)
  for (let i = 0; i < sky.length; i += 4) {
    for (let c = 0; c < 3; c++) sky[i + c] = input.daylight ? LAB_SKY_COLOUR[c] * LAB_SKY_RADIANCE : 0
    sky[i + 3] = 1
  }
  const environment = new DataTexture(sky, 32, 16, RGBAFormat, FloatType)
  environment.mapping = EquirectangularReflectionMapping; environment.needsUpdate = true
  scene.environment = environment; scene.background = environment
  if (snapshot.exterior && input.daylight && snapshot.exterior.background) {
    const source = snapshot.exterior.background
    scene.background = 'isTexture' in source ? copyTexture(source) : source.clone()
    scene.backgroundIntensity = snapshot.exterior.backgroundIntensity
    scene.backgroundRotation.set(...snapshot.exterior.backgroundRotation as [number, number, number])
  }
  for (const source of input.lights) {
    if (source.power <= 0) continue
    const light = source.kind === 'spot' ? new SpotLight() : new PointLight()
    light.color.set(source.color); light.intensity = source.power / (4 * Math.PI); light.distance = source.distance; light.decay = source.falloff
    light.position.fromArray(source.position)
    if (light instanceof SpotLight) { light.angle = source.angle; light.penumbra = source.penumbra; light.target.position.fromArray(source.target); scene.add(light.target) }
    scene.add(light)
  }
  if (input.daylight && input.sunColour.some(v => v > 0)) {
    const sun = new DirectionalLight(new Color().fromArray(input.sunColour), 1)
    sun.position.fromArray(input.sunDirection).multiplyScalar(100); scene.add(sun, sun.target)
  }
  scene.updateMatrixWorld(true)
  return { scene, triangles, windowEmitterTriangles, textureCount: textures.size,
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); environment.dispose(); scene.clear() } }
}
