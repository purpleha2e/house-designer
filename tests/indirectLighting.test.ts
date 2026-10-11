import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, BufferAttribute, BufferGeometry, DataUtils, InterleavedBuffer, InterleavedBufferAttribute, MeshStandardMaterial, Ray, SphericalHarmonics3, Vector3, type WebGLRenderer } from 'three'
import { createIndirectField, evaluateIndirectSH, INDIRECT_DISTANCE_SIZE, INDIRECT_MASK_SIZE, indirectGeometryFingerprint, roomProbePoint, serializeIndirectField, restoreIndirectField, writeIndirectProbe } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms, setIndirectLocalReflection } from '../src/indirectLightingShader.ts'
import { pointIsInsideRoomPolygon } from '../src/roomLightMask.ts'
import { applySpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'
import { createIndirectVisibility, createIndirectVisibilityFromSnapshot, snapshotIndirectGeometry, indirectOctDirection, indirectOctUV, indirectVisibilityWeight, writeIndirectVisibility } from '../src/indirectVisibility.ts'
import { INDIRECT_VOLUME_HEIGHT, sampleIndirectCoefficients, writeIndirectCeilingRow, writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { Group, Mesh } from 'three'

const square = (x: number) => [{ x, y: 0 }, { x: x + 4, y: 0 }, { x: x + 4, y: 4 }, { x, y: 4 }]

test('normalized and interleaved positions are decoded in worker geometry without UI-thread expansion', () => {
  const material = new MeshStandardMaterial(), scene = new Group()
  const normalized = new BufferGeometry().setAttribute('position', new BufferAttribute(new Int16Array([0,-32767,-32767,0,32767,-32767,0,0,32767]),3,true))
  const interleaved = new BufferGeometry().setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(
    new Float32Array([99,0,-1,-1,99,0,1,-1,99,0,0,1]),4),3,1))
  const a = new Mesh(normalized,material), b = new Mesh(interleaved,material); b.position.x = 2
  scene.add(a,b);scene.updateMatrixWorld(true)
  const snapshot = snapshotIndirectGeometry(scene)
  assert.equal(snapshot[0].position,normalized.attributes.position.array)
  assert.equal(snapshot[1].position,interleaved.attributes.position.array)
  const visibility=createIndirectVisibilityFromSnapshot(structuredClone(snapshot))
  assert.equal(visibility.distance(new Vector3(-1,0,0),new Vector3(1,0,0)),1)
  assert.equal(visibility.distance(new Vector3(1,0,0),new Vector3(1,0,0)),1)
  visibility.dispose();normalized.dispose();interleaved.dispose();material.dispose()
})

test('worker field data survives structured cloning with probe regions and texture layout intact', () => {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 3, rooms: [{ signature: 'room', polygon: square(0) }] }], 2)
  const restored = restoreIndirectField(structuredClone(serializeIndirectField(field)))
  assert.deepEqual(restored.mask.image.data, field.mask.image.data)
  assert.deepEqual(restored.positionData, field.positionData)
  assert.deepEqual(restored.bounds, field.bounds)
  assert.equal(restored.probes.length, field.probes.length)
  assert.ok(restored.probes.every(probe => restored.regions.includes(probe.region)))
  assert.deepEqual(restored.regions[0].centre.toArray(), field.regions[0].centre.toArray())
  assert.equal(restored.distanceWidth, field.distanceWidth)
  assert.equal(restored.volume.data.length, field.volume.data.length)
  field.dispose(); restored.dispose()
})

test('worker geometry snapshots retain opaque groups and world transforms without detaching live buffers', () => {
  const scene = new Group(), opaque = new MeshStandardMaterial(), glass = new MeshStandardMaterial()
  glass.name = 'Glass'
  const wall = new Mesh(new BoxGeometry(.2, 3, 4), opaque), glazing = new Mesh(new BoxGeometry(.1, 3, 4), glass)
  wall.position.set(2, 1.5, 2); wall.userData.houseDesignerRole = 'room-ceiling'
  glazing.position.set(-2, 1.5, 2); scene.add(wall, glazing); scene.updateMatrixWorld(true)
  const snapshot = snapshotIndirectGeometry(scene), cloned = structuredClone(snapshot)
  assert.equal(snapshot.length, 1, 'glass is excluded from opaque visibility')
  assert.equal(snapshot[0].structural, true)
  assert.ok(wall.geometry.attributes.position.array.byteLength > 0, 'live vertex buffers stay owned by the renderer')
  const visibility = createIndirectVisibilityFromSnapshot(cloned)
  assert.ok(Math.abs(visibility.distance(new Vector3(0, 1, 2), new Vector3(1, 0, 0)) - 1.9) < .001)
  assert.equal(visibility.distance(new Vector3(0, 1, 2), new Vector3(-1, 0, 0)), 80)
  visibility.dispose(); wall.geometry.dispose(); glazing.geometry.dispose(); opaque.dispose(); glass.dispose()
})

function sampleCachedLamp(field: ReturnType<typeof createIndirectField>, visibility: ReturnType<typeof createIndirectVisibility>,
  light: Vector3, position: Vector3) {
  const direction = position.clone().sub(light), distance = direction.length(), uv = indirectOctUV(direction), size = field.distanceSize
  const ix = Math.floor(Math.max(0, Math.min(size - 1, uv.x * size - .5)))
  const iy = Math.floor(Math.max(0, Math.min(size - 1, uv.y * size - .5)))
  const vertices = visibility.triangleTexture().image.data as Float32Array
  const ray = new Ray(light, direction.normalize()), a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3()
  for (let corner = 0; corner < 4; corner++) {
    const px = Math.min(ix + corner % 2, size - 1), py = Math.min(iy + Math.floor(corner / 2), size - 1)
    const id = field.distanceData[py * field.distanceWidth + px]
    if (!id) continue
    for (let triangle = 0; triangle < 2; triangle++) {
      const offset = ((id - 1) * 7 + 1 + triangle * 3) * 4
      a.fromArray(vertices, offset); b.fromArray(vertices, offset + 4); c.fromArray(vertices, offset + 8)
      if (ray.intersectTriangle(a, b, c, false, hit) && hit.distanceTo(light) < distance - .002) return 0
    }
  }
  return 1
}

test('equivalent rebuilt geometry retains its lighting cache; actual edits invalidate it', () => {
  const first = new BoxGeometry(4, 3, .2), rebuilt = new BoxGeometry(4, 3, .2)
  assert.notEqual(first.uuid, rebuilt.uuid)
  assert.equal(indirectGeometryFingerprint(first), indirectGeometryFingerprint(rebuilt))
  rebuilt.attributes.position.setX(0, 2.1); rebuilt.attributes.position.needsUpdate = true
  assert.notEqual(indirectGeometryFingerprint(first), indirectGeometryFingerprint(rebuilt))
  first.dispose(); rebuilt.dispose()
})

test('world probe grid does not select lighting by room label and keeps storeys separate', () => {
  const field = createIndirectField([
    { id: 'ground', elevation: 0, height: 2.4, rooms: [{ signature: 'same', polygon: square(0) }, { signature: 'next', polygon: square(4) }] },
    { id: 'first', elevation: 2.7, height: 2.4, rooms: [{ signature: 'same', polygon: square(0) }] },
  ])
  assert.equal(field.regions.length, 3)
  assert.deepEqual(field.regions.map(r => r.id), [1, 2, 3])
  const sh = new SphericalHarmonics3(); sh.coefficients[0].set(1, .5, .25)
  const probe = field.probes[0]
  writeIndirectProbe(field, probe.index, sh)
  assert.equal(DataUtils.fromHalfFloat(field.coefficients[0][probe.index * 4]), 1)
  assert.ok(field.probes.some(p => p.region.floorId === 'first'))
  assert.ok(field.grids[1].start > field.grids[0].start)
  const occupied = new Set((field.mask.image.data as Uint8Array).filter((_, index) => index % 4 === 0))
  assert.deepEqual([...occupied].sort(), [0, 255], 'mask stores inside/outside, with no distinct room IDs')
  assert.ok(field.probes.some(p => p.position.y > 1.5), 'vertical interpolation has two probe heights')
  field.dispose()
})

test('concave room probes relocate into the room and avoid wall boundaries', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 6 }, { x: 0, y: 6 }]
  for (const requested of [{ x: 3, y: 3 }, { x: 0, y: 0 }, { x: 5, y: .5 }]) {
    const point = roomProbePoint(polygon, requested)
    assert.ok(pointIsInsideRoomPolygon(point, polygon))
    assert.ok(point.x > 0 && point.y > 0)
  }
  const field = createIndirectField([{ id: 'L', elevation: 0, height: 2.4, rooms: [{ signature: 'L', polygon }] }])
  assert.ok(field.probes.every(p => pointIsInsideRoomPolygon({ x: p.position.x, y: p.position.z }, polygon)))
  field.dispose()
})

test('directional indirect light preserves RGB and responds to the surface normal', () => {
  const sh = new SphericalHarmonics3()
  sh.coefficients[0].set(.6, .3, .1); sh.coefficients[3].set(.2, .1, .03)
  const lit = evaluateIndirectSH(sh, new Vector3(1, 0, 0))
  const shaded = evaluateIndirectSH(sh, new Vector3(-1, 0, 0))
  assert.ok(lit.x > shaded.x && lit.y > shaded.y)
  assert.ok(lit.x > lit.y && lit.y > lit.z)
})

test('indirect shading composes once with existing hooks and supports batched world positions', () => {
  const field = createIndirectField([]), material = new MeshStandardMaterial({ color: '#ffffff' })
  const uniforms = createIndirectUniforms(field)
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <lights_fragment_end>' }
  applySpecularOnlyImageBasedLighting(material)
  const restore = applyIndirectLightingShader(material, uniforms)
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as WebGLRenderer)
  assert.match(shader.vertexShader, /batchingMatrix \* hdGIWorld/)
  assert.match(shader.vertexShader, /instanceMatrix \* hdGIWorld/)
  assert.match(shader.fragmentShader, /irradiance = hdGICapture/)
  assert.match(shader.fragmentShader, /iblIrradiance = vec3\(0\.0\)/)
  assert.match(shader.fragmentShader, /if \(hdGICapture < \.5 \|\| hdGIEnabled < \.5 \|\| index < 0\.0\) return -1\.0;/,
    'GI lamp occlusion is restricted to captures; display falls back to renderer lighting')
  assert.equal(material.color.getHexString(), 'ffffff')
  assert.equal(material.emissive.getHex(), 0)
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as WebGLRenderer)
  assert.equal(shader.fragmentShader.match(/float hdGIFloor\(/g)?.length, 1)
  restore(); material.dispose(); field.dispose()
})

test('fade clones inherit shader code without duplicating it or retaining stale lighting uniforms', () => {
  const field = createIndirectField([]), material = new MeshStandardMaterial()
  const first = createIndirectUniforms(field), current = createIndirectUniforms(field)
  applySpecularOnlyImageBasedLighting(material); applyIndirectLightingShader(material, first)
  const clone = material.clone()
  clone.onBeforeCompile = material.onBeforeCompile.bind(material)
  clone.customProgramCacheKey = material.customProgramCacheKey.bind(material)
  applySpecularOnlyImageBasedLighting(clone); applyIndirectLightingShader(clone, current)
  setIndirectLocalReflection(clone, true)
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <lights_fragment_end>' }
  clone.onBeforeCompile(shader as Parameters<typeof clone.onBeforeCompile>[0], {} as WebGLRenderer)
  assert.equal(shader.uniforms.hdGIEnabled, current.hdGIEnabled)
  assert.equal((shader.uniforms.hdGILocalReflection as { value: number }).value, 1)
  assert.equal(shader.fragmentShader.match(/float hdGIFloor\(/g)?.length, 1)
  assert.equal(shader.fragmentShader.match(/House Designer: retain environment radiance/g)?.length, 1)
  assert.equal(clone.customProgramCacheKey(), material.customProgramCacheKey())
  material.dispose(); clone.dispose(); field.dispose()
})

test('geometry visibility blocks a wall and passes through a real opening regardless of room labels', () => {
  const scene = new Group(), material = new MeshStandardMaterial()
  const left = new Mesh(new BoxGeometry(.2, 3, 1), material), right = left.clone()
  left.position.set(0, 1.5, -1.5); right.position.set(0, 1.5, 1.5)
  scene.add(left, right); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), direction = new Vector3(1, 0, 0)
  assert.equal(visibility.distance(new Vector3(-2, 1, 0), direction), 80, 'door opening transmits light')
  const blocked = visibility.distance(new Vector3(-2, 1, 1.5), direction)
  assert.ok(blocked > 1.8 && blocked < 2)
  assert.ok(indirectVisibilityWeight(4, blocked, blocked * blocked) < .00001, 'opposing probe is rejected')
  assert.equal(indirectVisibilityWeight(4, 80, 6400), 1)
  assert.ok(indirectOctDirection(.5, .5).distanceTo(new Vector3(0, 0, 1)) < 1e-6)
  visibility.dispose(); left.geometry.dispose(); material.dispose()
})

test('preblended world lighting blocks solid partitions and blends continuously when they are removed', () => {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 3,
    rooms: [{ signature: 'red', polygon: square(0) }, { signature: 'blue', polygon: square(4) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), wall = new Mesh(new BoxGeometry(.2, 3, 4.2), material)
  wall.position.set(4, 1.5, 2); scene.add(wall); scene.updateMatrixWorld(true)
  let visibility = createIndirectVisibility(scene)
  for (const probe of field.probes) {
    const sh = new SphericalHarmonics3(); sh.coefficients[0].set(probe.position.x < 4 ? 1 : 0, 0, probe.position.x < 4 ? 0 : 1)
    writeIndirectProbe(field, probe.index, sh)
  }
  const left = new Float64Array(12), right = new Float64Array(12)
  sampleIndirectCoefficients(field, 0, 3.7, 1.5, 2, left, visibility)
  sampleIndirectCoefficients(field, 0, 4.3, 1.5, 2, right, visibility)
  assert.ok(left[0] > .95 && left[8] < .05, 'solid partition excludes blue probes on the red side')
  assert.ok(right[8] > .95 && right[0] < .05, 'solid partition excludes red probes on the blue side')
  visibility.dispose(); scene.remove(wall); visibility = createIndirectVisibility(scene)
  for (const probe of field.probes) writeIndirectVisibility(field, probe.index, probe.position, visibility)
  sampleIndirectCoefficients(field, 0, 3.99, 1.5, 2, left, visibility)
  sampleIndirectCoefficients(field, 0, 4.01, 1.5, 2, right, visibility)
  assert.ok(left[0] > 0 && left[8] > 0, 'both sides contribute when geometry allows it')
  assert.ok(Math.abs(left[0] - right[0]) < .02 && Math.abs(left[8] - right[8]) < .02,
    'room labels introduce no step in the cached volume')
  visibility.dispose(); wall.geometry.dispose(); material.dispose(); field.dispose()
})

test('constant indirect light has no dark wedges near walls or regular grid boundaries', () => {
  const field = createIndirectField([{ id: 'floor', elevation: 0, height: 3, rooms: [{ signature: 'room', polygon: square(0) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), wall = new Mesh(new BoxGeometry(.2, 3, 4.2), material)
  wall.position.set(4, 1.5, 2); scene.add(wall); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), sh = new SphericalHarmonics3(), result = new Float64Array(12)
  sh.coefficients[0].set(.6, .3, .1)
  for (const probe of field.probes) writeIndirectProbe(field, probe.index, sh)
  for (const y of [.1, .75, 1.5, 2.25, 2.9]) for (let z = .1; z < 3.9; z += .07) {
    sampleIndirectCoefficients(field, 0, 3.86, y, z, result, visibility)
    assert.ok(Math.abs(result[0] - .6) < .001, `constant wall lighting at y=${y}, z=${z}`)
  }
  visibility.dispose(); wall.geometry.dispose(); material.dispose(); field.dispose()
})

test('samples just inside a thin partition cannot import light from the adjacent room', () => {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 3,
    rooms: [{ signature: 'dark', polygon: square(0) }, { signature: 'lit', polygon: square(4) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), wall = new Mesh(new BoxGeometry(.1, 3, 4.2), material)
  wall.position.set(4, 1.5, 2); scene.add(wall); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), result = new Float64Array(12)
  for (const probe of field.probes) {
    const sh = new SphericalHarmonics3(); sh.coefficients[0].set(probe.position.x > 4 ? 1 : 0, 0, 0)
    writeIndirectProbe(field, probe.index, sh)
  }
  for (const x of [3.965, 4, 4.035]) {
    assert.equal(sampleIndirectCoefficients(field, 0, x, 1.5, 2, result, visibility), 0,
      `voxel inside the partition at x=${x} must have no visible probe support`)
    assert.equal(result[0], 0)
  }
  assert.ok(sampleIndirectCoefficients(field, 0, 3.94, 1.5, 2, result, visibility) > 0)
  assert.equal(result[0], 0, 'valid dark-side samples stay dark')
  assert.ok(sampleIndirectCoefficients(field, 0, 4.06, 1.5, 2, result, visibility) > 0)
  assert.equal(result[0], 1, 'the lit side remains lit right up to the wall')
  visibility.dispose(); wall.geometry.dispose(); material.dispose(); field.dispose()
})

test('lamp visibility atlas allocates actual lights and supports isolated row updates', () => {
  const field = createIndirectField([], 4), scene = new Group(), visibility = createIndirectVisibility(scene)
  assert.equal(field.distanceData.byteLength, 4 * INDIRECT_DISTANCE_SIZE ** 2 * 4)
  field.distanceData.fill(-1)
  writeIndirectVisibility(field, 3, new Vector3(), visibility, 4, 2)
  const offset = (row: number) => (INDIRECT_DISTANCE_SIZE + row) * field.distanceWidth + INDIRECT_DISTANCE_SIZE
  assert.equal(field.distanceData[0], -1, 'updating one lamp never touches another lamp')
  assert.equal(field.distanceData[offset(3)], -1)
  assert.equal(field.distanceData[offset(4)], 0)
  assert.equal(field.distanceData[offset(5)], 0)
  assert.equal(field.distanceData[offset(6)], -1)
  visibility.dispose(); field.dispose()
})

test('indoor occupancy follows a sloping ceiling instead of projecting onto exterior roofs', () => {
  const field = createIndirectField([{ id: 'floor', elevation: 0, height: 4, rooms: [{ signature: 'room', polygon: square(0) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), roof = new Mesh(new BoxGeometry(8, .1, 8), material)
  roof.position.set(2, 2.5, 2); roof.rotation.z = .2; scene.add(roof); scene.updateMatrixWorld(true)
  const structure = createIndirectVisibility(scene), z = Math.floor((2 - field.bounds.minZ) / field.bounds.size * INDIRECT_MASK_SIZE)
  writeIndirectCeilingRow(field, z, structure)
  const mask = field.mask.image.data as Uint8Array, range = field.ranges[0]
  for (const x of [1, 2, 3]) {
    const pixel = Math.floor((x - field.bounds.minX) / field.bounds.size * INDIRECT_MASK_SIZE)
    const offset = (z * INDIRECT_MASK_SIZE + pixel) * 4
    const ceiling = range.bottom + ((mask[offset + 1] * 256 + mask[offset + 2]) / 65535) * (range.top - range.bottom)
    const expected = 2.5 + Math.tan(.2) * (x - 2) - .05 / Math.cos(.2)
    assert.ok(Math.abs(ceiling - expected) < .01)
    assert.ok(expected - .08 < ceiling && expected + .15 > ceiling, 'inside and outside roof faces get different occupancy')
  }
  structure.dispose(); roof.geometry.dispose(); material.dispose(); field.dispose()
})

test('volume filtering at a ceiling never blends room light with empty space above the ceiling', () => {
  const field = createIndirectField([{ id: 'floor', elevation: 0, height: 2.7, rooms: [{ signature: 'room', polygon: square(0) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), ceiling = new Mesh(new BoxGeometry(8, .2, 8), material)
  ceiling.position.set(2, 2.5, 2); scene.add(ceiling); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), sh = new SphericalHarmonics3(), result = new Float64Array(12)
  sh.coefficients[0].set(.6, .3, .1)
  for (const probe of field.probes) writeIndirectProbe(field, probe.index, sh)
  const volume = field.volume, iz = Math.floor(volume.n / 2), ix = iz
  const z = field.bounds.minZ + iz / (volume.n - 1) * field.bounds.size
  writeIndirectCeilingRow(field, Math.floor((z - field.bounds.minZ) / field.bounds.size * INDIRECT_MASK_SIZE), visibility)
  writeIndirectVolumeRow(field, iz * INDIRECT_VOLUME_HEIGHT + INDIRECT_VOLUME_HEIGHT - 1, result, visibility)
  const offset = ((iz * volume.height * 4 + INDIRECT_VOLUME_HEIGHT) * volume.n + ix) * 4
  assert.ok(Math.abs(DataUtils.fromHalfFloat(volume.data[offset]) - .6) < .001,
    'border voxel extrapolates interior light instead of injecting a dark ceiling seam')
  visibility.dispose(); ceiling.geometry.dispose(); material.dispose(); field.dispose()
})

test('filtered cache excludes unsupported wall voxels without brightening valid black samples', () => {
  const field = createIndirectField([{ id: 'floor', elevation: 0, height: 3, rooms: [{ signature: 'room', polygon: square(0) }] }])
  const scene = new Group(), material = new MeshStandardMaterial(), wall = new Mesh(new BoxGeometry(.2, 4, 8), material)
  wall.position.set(3.95, 1.5, 2); scene.add(wall); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), sh = new SphericalHarmonics3(), result = new Float64Array(12)
  sh.coefficients[0].set(.6, .3, .1)
  for (const probe of field.probes) writeIndirectProbe(field, probe.index, sh)
  const volume = field.volume, iz = Math.floor(volume.n / 2), iy = 5
  writeIndirectVolumeRow(field, iz * INDIRECT_VOLUME_HEIGHT + iy, result, visibility)
  const read = (x: number, component: number) => DataUtils.fromHalfFloat(volume.data[((iz * volume.height * 4 + iy + 1) * volume.n + x) * 4 + component])
  const solid = Math.round((3.95 - field.bounds.minX) / field.bounds.size * (volume.n - 1))
  const valid = solid - 1
  assert.equal(read(solid, 3), 0, 'solid wall has no visible probe support')
  assert.equal(read(valid, 3), 1)
  const filteredCoverage = (read(valid, 3) + read(solid, 3)) / 2
  assert.ok(Math.abs(((read(valid, 0) + read(solid, 0)) / 2) / filteredCoverage - .6) < .001,
    'a half-covered filter footprint preserves constant illumination')
  sh.zero(); for (const probe of field.probes) writeIndirectProbe(field, probe.index, sh)
  writeIndirectVolumeRow(field, iz * INDIRECT_VOLUME_HEIGHT + iy, result, visibility)
  assert.equal(read(valid, 3), 1, 'valid darkness is distinct from missing support')
  assert.equal(read(valid, 0), 0)
  visibility.dispose(); wall.geometry.dispose(); material.dispose(); field.dispose()
})

test('cached lamp visibility does not self-shadow walls and ceiling corners', () => {
  const field = createIndirectField([]), scene = new Group(), material = new MeshStandardMaterial()
  const walls = [new Mesh(new BoxGeometry(.1, 8, 8), material), new Mesh(new BoxGeometry(8, 8, .1), material),
    new Mesh(new BoxGeometry(8, .1, 8), material)]
  walls[0].position.set(4.05, 1.5, 2); walls[1].position.set(2, 1.5, 4.05); walls[2].position.set(2, 3.05, 2)
  scene.add(...walls); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), light = new Vector3(2, 1.5, 2)
  writeIndirectVisibility(field, 0, light, visibility)
  const sample = (position: Vector3) => sampleCachedLamp(field, visibility, light, position)
  for (let y = .2; y < 2.98; y += .11) for (const z of [2.01, 2.7, 3.5, 3.96]) {
    assert.ok(sample(new Vector3(3.96, y, z)) > .999, `wall self-shadow at y=${y}, z=${z}`)
  }
  for (let x = 2.1; x < 3.97; x += .11) assert.ok(sample(new Vector3(x, 2.96, 3.96)) > .999)
  assert.equal(sample(new Vector3(4.4, 1.5, 2)), 0, 'a receiver behind the wall is still occluded')
  visibility.dispose(); walls.forEach(wall => wall.geometry.dispose()); material.dispose(); field.dispose()
})

test('narrow door trim cannot spread a cached lamp shadow across a broad wall area', () => {
  const field = createIndirectField([]), scene = new Group(), material = new MeshStandardMaterial()
  const wall = new Mesh(new BoxGeometry(.1, 4, 8), material), trim = new Mesh(new BoxGeometry(.2, 3, .08), material)
  wall.position.set(4.05, 1.5, 2); trim.position.set(3.75, 1.5, 2.4)
  scene.add(wall, trim); scene.updateMatrixWorld(true)
  const visibility = createIndirectVisibility(scene), light = new Vector3(2, 1.5, 2)
  writeIndirectVisibility(field, 0, light, visibility)
  let tested = 0
  for (let z = 1; z < 3.5; z += .01) {
    // Stay clear of the real projected trim shadow and its filter penumbra.
    const inShadow = z >= 2.45 && z <= 2.48
    if (z > 2.3 && z < 2.62 && !inShadow) continue
    const sampled = sampleCachedLamp(field, visibility, light, new Vector3(3.96, 1.5, z))
    if (inShadow) assert.ok(sampled < .02, `narrow trim must still block the lamp at z=${z}: ${sampled}`)
    else assert.ok(sampled > .98, `oversized trim shadow at z=${z}: ${sampled}`)
    tested++
  }
  assert.ok(tested > 150)
  // A straight projected edge must stay straight as it crosses cache texels.
  for (let y = .3; y < 2.7; y += .013) for (const z of [2.37, 2.4, 2.5, 2.54]) {
    const point = new Vector3(3.96, y, z), direction = point.clone().sub(light), distance = direction.length()
    const exact = visibility.distance(light, direction.normalize(), distance - .002) >= distance - .002 ? 1 : 0
    assert.equal(sampleCachedLamp(field, visibility, light, point), exact, `shadow silhouette at y=${y}, z=${z}`)
  }
  visibility.dispose(); wall.geometry.dispose(); trim.geometry.dispose(); material.dispose(); field.dispose()
})
