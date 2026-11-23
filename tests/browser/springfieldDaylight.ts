import { BufferAttribute, BufferGeometry, DoubleSide, Frustum, Matrix4, Ray, Triangle, Vector3, WebGLRenderTarget } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { RootState } from '@react-three/fiber'
import { createDiffuseImageReader, snapshotReferenceScene } from '../../src/diffuseSceneSnapshot'
import { sampleReferenceSurface } from '../../src/diffuseSceneMaterials'
import type { SurfaceAtlas } from '../../src/lumenSurfaceCache'

/** Offline reference measurement. Test the actual finish triangles, window
 * openings and authored albedo independently of any runtime cache or probes. */
export async function inspectLandingSun(state: RootState, materialId: string, floorElevation: number) {
  const camera = state.camera
  camera.updateMatrixWorld()
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  const imageReader = createDiffuseImageReader()
  const gl = state.gl, target = new WebGLRenderTarget(1, 1)
  const previous = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
  const snapshot = await (async () => {
    try {
      let compile: Promise<unknown>
      try {
        gl.setRenderTarget(target)
        compile = gl.compileAsync(imageReader.scene, imageReader.camera)
      } finally { gl.setRenderTarget(previous, face, mip) }
      await compile
      return await snapshotReferenceScene(state, mesh => {
        if (mesh.userData.houseDesignerRole !== 'room-floor-finish') return 0
        const [, elevation, finish] = JSON.parse(mesh.userData.floorSurfaceBatchKey)
        return finish === materialId && Math.abs(elevation - floorElevation) < .1 ? 2 : 1
      }, { imageReader, textureLimit: 64, diffusePbr: true, interactive: { textureCache: new WeakMap(), visitMesh() {} } })
    } finally { target.dispose(); imageReader.dispose() }
  })()
  const data = snapshot.data
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  const tree = new MeshBVH(geometry)
  const ray = new Ray(), point = new Vector3(), direction = new Vector3(), normal = new Vector3()
  const sun = new Vector3().fromArray(data.sunDirection).normalize(), down = new Vector3(0, -1, 0)
  const triangle = new Triangle(), bary = new Vector3()
  const footprint = { samples: 0, sunlit: 0, outsideFrustum: 0, behindCamera: 0, occluded: 0 }
  const examples: { position: number[]; albedo: number[]; reflectedSun: number[]; behindCamera: boolean }[] = []
  // Sample a 5 m square about the landing eye. Reject neighbouring rooms
  // without the same finish, stair voids and hits above the floor.
  for (let z = -25; z <= 25; z++) for (let x = -25; x <= 25; x++) {
    ray.origin.set(camera.position.x + x * .1, floorElevation + .12, camera.position.z + z * .1)
    ray.direction.copy(down)
    const hit = tree.raycastFirst(ray, DoubleSide, .0001, .2)
    if (!hit?.face) continue
    const index = Math.floor(hit.face.a / 3)
    if (data.sourceCategories?.[index] !== 2) continue
    footprint.samples++
    normal.copy(hit.face.normal)
    if (normal.y < 0) normal.negate()
    point.copy(hit.point).addScaledVector(normal, .001)
    ray.set(point, sun)
    if (normal.dot(sun) <= 0 || tree.raycastFirst(ray, DoubleSide, .0001, 80)) continue
    footprint.sunlit++
    const behindCamera = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0
    if (behindCamera) footprint.behindCamera++
    if (!frustum.containsPoint(point)) footprint.outsideFrustum++
    direction.subVectors(camera.position, point)
    const distance = direction.length()
    ray.set(point, direction.normalize())
    if (tree.raycastFirst(ray, DoubleSide, .001, distance - .001)) footprint.occluded++
    if (examples.length >= 12 || (examples.length && !behindCamera)) continue
    const offset = index * 9
    triangle.a.fromArray(data.positions, offset)
    triangle.b.fromArray(data.positions, offset + 3)
    triangle.c.fromArray(data.positions, offset + 6)
    triangle.getBarycoord(hit.point, bary)
    const uv = (channel: number) => bary.x * data.uvs[index * 6 + channel] + bary.y * data.uvs[index * 6 + 2 + channel] + bary.z * data.uvs[index * 6 + 4 + channel]
    const { rho } = sampleReferenceSurface(data, index, uv(0), uv(1), bary)
    examples.push({ position: hit.point.toArray(), albedo: rho, behindCamera,
      reflectedSun: rho.map((value, channel) => value * data.sunIrradiance[channel] * normal.dot(sun) / Math.PI) })
  }
  geometry.dispose()
  const worker = new Worker(new URL('../../src/lumenSurfaceCache.worker.ts',import.meta.url), {type:'module'})
  const cache = await new Promise<{
    atlas:SurfaceAtlas; lighting:{ radiance:Float32Array; lit:number; litCarpet:number; ms:number }; buildMs:number
  }>((resolve,reject) => {
    worker.onmessage = event => event.data.error ? reject(Error(event.data.error)) : resolve(event.data)
    worker.onerror = event => reject(Error(event.message))
    worker.postMessage({kind:'scene',id:1,data,center:camera.position.toArray(),direction:data.sunDirection,irradiance:data.sunIrradiance})
  }).finally(() => worker.terminate())
  let litCarpetNearLanding = 0, litCarpetBehind = 0, litCarpetOutsideFrustum = 0
  const {atlas,lighting} = cache
  const cachedExamples = []
  for (let i=0;i<atlas.count;i++) {
    const at = i*4
    if (atlas.normals[at+3] !== 2 || lighting.radiance[at+3] <= 0) continue
    point.fromArray(atlas.positions,at)
    if (Math.abs(point.x-camera.position.x)>2.5 || Math.abs(point.z-camera.position.z)>2.5) continue
    litCarpetNearLanding++
    const behind = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0
    if (behind) litCarpetBehind++
    if (!frustum.containsPoint(point)) litCarpetOutsideFrustum++
    if (cachedExamples.length < 5 && (behind || !frustum.containsPoint(point))) cachedExamples.push({
      position:point.toArray(), material:atlas.positions[at+3], albedo:Array.from(atlas.albedo.subarray(at,at+3)),
      directReflected:Array.from(lighting.radiance.subarray(at,at+3)), behind })
  }
  const surfaceCache = { count:atlas.count, spacing:atlas.spacing, dimensions:atlas.dimensions,
    staticBytes:atlas.cells.byteLength+atlas.positions.byteLength+atlas.normals.byteLength+atlas.albedo.byteLength,
    lightingBytes:lighting.radiance.byteLength, buildMs:cache.buildMs, lightMs:lighting.ms, litCarpetNearLanding,
    litCarpetBehind, litCarpetOutsideFrustum, cachedExamples }
  return { footprint, examples, surfaceCache, floorElevation, materialId, sunDirection: data.sunDirection,
    sunIrradiance: data.sunIrradiance, artificialLights: data.lights.length, triangles: snapshot.triangles,
    snapshotMs: snapshot.snapshotMs, unsupported: snapshot.unsupported }
}
