import { DataUtils, DirectionalLight, HalfFloatType, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera,
  PlaneGeometry, PointLight, Scene, ShaderMaterial, SpotLight, Vector3, WebGLRenderTarget, type Texture } from 'three'
import type { RootState } from '@react-three/fiber'
import { indirectGeometryRanges } from '../../src/indirectVisibility'
import { isSelectionDecoration } from '../../src/shaderWarmup'
import type { ReferenceLight, ReferenceMaterial, ReferenceSceneData, ReferenceTexture } from '../sceneLightingReference'
import { includeViewportObject } from '../../src/viewportSurfaceVisibility'

/** Read original material images, rather than GI captures, for the independent
 * CPU solver. GPU texture sampling also handles compressed KTX2 assets. */
export async function snapshotReferenceScene(s: RootState, classifyTriangle?: (mesh: Mesh, triangle: number) => number) {
  const started = performance.now(), gl = s.gl, previousTarget = gl.getRenderTarget(), autoClear = gl.autoClear
  const textureList: Texture[] = [], materials: ReferenceMaterial[] = [], materialIds = new Map<MeshStandardMaterial, number>()
  const meshes: { mesh: Mesh; ranges: ReturnType<typeof indirectGeometryRanges> }[] = []
  s.scene.updateMatrixWorld(true)
  s.scene.traverse(object => {
    if (!includeViewportObject(object)) return
    if (!(object instanceof Mesh) || isSelectionDecoration(object) || object.userData.houseDesignerRole === 'ground-image') return
    if ('isBatchedMesh' in object) throw Error('Reference snapshot needs explicit BatchedMesh instance support')
    const ranges = indirectGeometryRanges(object)
    if (ranges.length) meshes.push({ mesh: object, ranges })
  })
  const count = meshes.reduce((sum, { mesh, ranges }) => sum + ranges.reduce((n, range) => n + Math.floor(range.count / 3) * 3, 0) * (mesh instanceof InstancedMesh ? mesh.count : 1), 0)
  const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2), materialIndices = new Uint16Array(count / 3), sourceCategories=classifyTriangle?new Uint8Array(count/3):undefined
  const vertex = new Vector3(), matrix = new Matrix4(), local = new Matrix4()
  let output = 0
  for (const { mesh, ranges } of meshes) {
    const source = mesh.geometry, entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = source.groups.length ? source.groups : [{ start: 0, count: source.index?.count ?? source.attributes.position.count, materialIndex: 0 }]
    for (let instance = 0; instance < (mesh instanceof InstancedMesh ? mesh.count : 1); instance++) {
      matrix.copy(mesh.matrixWorld)
      if (mesh instanceof InstancedMesh) { mesh.getMatrixAt(instance, local); matrix.multiply(local) }
      const mirrored = matrix.determinant() < 0
      for (const range of ranges) {
        const group = groups.find(group => group.start === range.start)!
        const material = entries[Array.isArray(mesh.material) ? group.materialIndex ?? 0 : 0] as MeshStandardMaterial
        let id = materialIds.get(material)
        if (id === undefined) {
          id = materials.length; materialIds.set(material, id)
          const map = material.map
          // Material clones can share one immutable image while owning different
          // UV transforms. Store that image once; each material keeps its matrix.
          let texture = map ? textureList.findIndex(texture => texture.source === map.source && texture.colorSpace === map.colorSpace &&
            texture.flipY === map.flipY && texture.format === map.format && texture.type === map.type) : -1
          if (map && texture < 0) { texture = textureList.length; textureList.push(map) }
          map?.updateMatrix()
          materials.push({ color: [material.color.r, material.color.g, material.color.b], metalness: material.metalness, map: texture,
            matrix: map?.matrix.toArray() ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], wrapS: map?.wrapS ?? 1001, wrapT: map?.wrapT ?? 1001 })
        }
        const uv = source.attributes[material.map?.channel ? `uv${material.map.channel}` : 'uv']
        for (let triangle = range.start; triangle + 2 < range.start + range.count; triangle += 3) {
          materialIndices[output / 3] = id
          if(sourceCategories)sourceCategories[output/3]=classifyTriangle!(mesh,triangle/3)
          for (let corner = 0; corner < 3; corner++) {
            const j = mirrored && corner ? 3 - corner : corner, index = source.index?.getX(triangle + j) ?? triangle + j
            vertex.fromBufferAttribute(source.attributes.position, index).applyMatrix4(matrix).toArray(positions, output * 3)
            uvs[output * 2] = uv?.getX(index) ?? 0; uvs[output * 2 + 1] = uv?.getY(index) ?? 0
            output++
          }
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const textures: ReferenceTexture[] = [], scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geometry = new PlaneGeometry(2, 2), material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { source: { value: null } }, vertexShader: 'varying vec2 vReferenceUV;void main(){vReferenceUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'varying vec2 vReferenceUV;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vReferenceUV);}' })
  scene.add(new Mesh(geometry, material))
  try {
    if (textureList.length) { material.uniforms.source.value = textureList[0]; await gl.compileAsync(scene, camera) }
    for (const texture of textureList) {
      s.scene.userData.referenceMeasurementProgress={stage:'reference texture',index:textures.length,total:textureList.length}
      const image = texture.image as { width: number; height: number }
      if (!image?.width || !image.height) throw Error('Missing original reference texture dimensions: ' + texture.name)
      const target = new WebGLRenderTarget(image.width, image.height, { type: HalfFloatType, depthBuffer: false })
      try {
        material.uniforms.source.value = texture
        gl.autoClear = true; gl.setRenderTarget(target); gl.render(scene, camera)
        const pixels = new Uint16Array(image.width * image.height * 4)
        await gl.readRenderTargetPixelsAsync(target, 0, 0, image.width, image.height, pixels)
        if (pixels.some(value => !Number.isFinite(DataUtils.fromHalfFloat(value)))) throw Error('Invalid reference texture readback')
        textures.push({ width: image.width, height: image.height, pixels })
      } finally { target.dispose() }
    }
    let sun: DirectionalLight | undefined
    const lights: ReferenceLight[] = []
    s.scene.traverseVisible(object => {
      if (object instanceof DirectionalLight && object.userData.houseDesignerRole === 'sun-light') sun = object
      if ((object instanceof PointLight || object instanceof SpotLight) && object.intensity > 0) lights.push({
        position: object.getWorldPosition(new Vector3()).toArray(), color: [object.color.r, object.color.g, object.color.b], intensity: object.intensity,
        distance: object.distance, decay: object.decay,
        ...(object instanceof SpotLight ? { direction: object.target.getWorldPosition(new Vector3()).sub(object.getWorldPosition(new Vector3())).normalize().toArray(),
          cone: Math.cos(object.angle), penumbra: Math.cos(object.angle * (1 - object.penumbra)) } : {}),
      })
    })
    const uniforms = s.scene.userData.getIndirectUniforms(), gain = s.scene.userData.getBakedIndirectLighting?.()?.settings.daylightBounceStrength ?? uniforms.hdSkyRadianceBase.value.x / .65
    const data: ReferenceSceneData = { positions, uvs, materialIndices, materials, textures,
      skyBase: uniforms.hdSkyRadianceBase.value.toArray(), skySun: uniforms.hdSkyDisplaySunIrradiance.value.clone().multiplyScalar(gain).toArray(),
      skyMode: uniforms.hdSkyMode.value > 1.5 ? 'overcast' : 'clear',
      sunDirection: sun ? sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3())).normalize().toArray() : [0, 1, 0],
      sunIrradiance: sun ? sun.color.toArray().map(value => value * sun!.intensity) as [number, number, number] : [0, 0, 0], daylightGain: gain, lights }
    return { data:{...data,...(sourceCategories?{sourceCategories}:{})}, snapshotMs: performance.now() - started, triangles: count / 3, materials: materials.length, textures: textures.length,
      textureBytes: textures.reduce((sum, texture) => sum + texture.pixels.byteLength, 0) }
  } finally { gl.setRenderTarget(previousTarget); gl.autoClear = autoClear; geometry.dispose(); material.dispose() }
}
