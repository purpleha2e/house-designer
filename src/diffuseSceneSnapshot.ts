import { DataUtils, DirectionalLight, HalfFloatType, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera,
  PlaneGeometry, PointLight, Scene, ShaderMaterial, SpotLight, Vector3, WebGLRenderTarget, type Texture } from 'three'
import type { RootState } from '@react-three/fiber'
import type { Object3D } from 'three'
import { indirectMaterialRanges } from './indirectVisibility.ts'
import { isSelectionDecoration } from './shaderWarmup.ts'
import type { ReferenceLight, ReferenceMaterial, ReferenceSampler, ReferenceSceneData, ReferenceTexture } from './diffuseSceneMaterials'
import { hasViewportSurfaceVisibility, includeViewportObject } from './viewportSurfaceVisibility.ts'
import { isBatchedModelSource } from './importedModelBatching.ts'

export class DiffuseSnapshotChanged extends Error {
  constructor(){super('Scene geometry changed during the diffuse snapshot')}
}

/** A viewport can keep the texture readback shader resident across snapshots
 * and compile it into a linear target alongside its other startup passes. */
export function createDiffuseImageReader() {
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // Match the position + UV fullscreen geometry used for shader warm-up.
  // Three's program key includes vertex normals even for this unlit shader.
  const geometry = new PlaneGeometry(2, 2).deleteAttribute('normal')
  const material = new ShaderMaterial({ name: 'DiffuseImageReader', depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { source: { value: null } },
    vertexShader: 'varying vec2 vReferenceUV;void main(){vReferenceUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'varying vec2 vReferenceUV;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vReferenceUV);}' })
  scene.add(new Mesh(geometry, material))
  return { scene, camera, material, dispose() { geometry.dispose(); material.dispose(); scene.clear() } }
}

/** Read original material images, rather than GI captures, for the independent
 * CPU solver. GPU texture sampling also handles compressed KTX2 assets. */
export async function snapshotReferenceScene(s: Pick<RootState, 'scene' | 'gl'>, classifyTriangle?: (mesh: Mesh, triangle: number) => number,
  options: { textureLimit?: number; diffusePbr?: boolean; cancelled?: () => boolean; imageReader?: ReturnType<typeof createDiffuseImageReader>;
    interactive?: { textureCache: WeakMap<Texture, { key: string; value: ReferenceTexture }>; visitMesh: (mesh: Mesh) => void;
      detailIndices?:(mesh:Mesh,start:number,count:number)=>Promise<Uint32Array|null> } } = {}) {
  const started = performance.now(), gl = s.gl
  const textureList: Texture[] = [], materials: ReferenceMaterial[] = [], materialIds = new Map<MeshStandardMaterial, number>()
  const unsupported = new Map<string, number>()
  const report = (key: string) => unsupported.set(key, (unsupported.get(key) ?? 0) + 1)
  let resizedTextures = 0
  const check = () => { if (options.cancelled?.()) throw Error('Diffuse scene snapshot superseded') }
  const meshes: {mesh:Mesh;source:Mesh['geometry']; instances:number;world:Matrix4;
    ranges:{start:number;count:number;material:MeshStandardMaterial;indices?:Uint32Array}[]}[] = []
  s.scene.updateMatrixWorld(true)
  s.scene.traverse(object => {
    if (!(object instanceof Mesh) || isSelectionDecoration(object) || object.userData.houseDesignerRole === 'ground-image') return
    if (options.interactive) {
      for (let parent: Object3D | null = object; parent; parent = parent.parent) {
        if (!parent.visible && !isBatchedModelSource(parent) && !hasViewportSurfaceVisibility(parent)) return
        if (/^model-batch/.test(String(parent.userData.houseDesignerRole))) return
      }
      options.interactive.visitMesh(object)
      if ('isBatchedMesh' in object) { report('batched mesh without editable source'); return }
      const entries = Array.isArray(object.material) ? object.material : [object.material]
      for (const entry of entries) if (!(entry instanceof MeshStandardMaterial) && entry.visible && entry.colorWrite)
        report('unsupported material: ' + entry.type)
    } else {
      if (!includeViewportObject(object)) return
      if ('isBatchedMesh' in object) throw Error('Reference snapshot needs explicit BatchedMesh instance support')
    }
    if ('isSkinnedMesh' in object || object.morphTargetInfluences?.some(weight => weight !== 0))
      report('skinning or active morph targets')
    if (object instanceof InstancedMesh && object.instanceColor) report('instance colour')
    const ranges=indirectMaterialRanges(object)
    if(ranges.length)meshes.push({mesh:object,source:object.geometry,ranges,world:object.matrixWorld.clone(),
      instances:object instanceof InstancedMesh?object.count:1})
  })
  let count=0,originalTriangles=0,reducedRanges=0
  const extractionMs=performance.now()-started
  for(const {mesh,source,ranges,instances} of meshes){
    for(const range of ranges){
      originalTriangles+=Math.floor(range.count/3)*instances
      if(options.interactive?.detailIndices && range.count>=768){
        check()
        if(mesh.geometry!==source)throw new DiffuseSnapshotChanged()
        const indices=await options.interactive.detailIndices(mesh,range.start,range.count)
        if(indices){range.indices=indices;reducedRanges+=instances}
      }
      count+=Math.floor((range.indices?.length??range.count)/3)*3*instances
    }
  }
  const sourceIds=options.interactive?new Uint32Array(count/3):undefined
  const simplificationMs=performance.now()-started-extractionMs
  const sourceNames:string[]=[]
  const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2), materialIndices = new Uint16Array(count / 3), sourceCategories=classifyTriangle?new Uint8Array(count/3):undefined
  let metalnessUVs: Float32Array | undefined, emissionUVs: Float32Array | undefined
  const sampler = (map: Texture | null): ReferenceSampler => {
    // Material clones can share immutable image data with distinct UV transforms.
    let texture = map ? textureList.findIndex(texture => texture.source === map.source && texture.colorSpace === map.colorSpace &&
      texture.flipY === map.flipY && texture.format === map.format && texture.type === map.type) : -1
    if (map && texture < 0) { texture = textureList.length; textureList.push(map) }
    if (map?.matrixAutoUpdate) map.updateMatrix()
    return { map: texture, matrix: map?.matrix.toArray() ?? [1, 0, 0, 0, 1, 0, 0, 0, 1],
      wrapS: map?.wrapS ?? 1001, wrapT: map?.wrapT ?? 1001 }
  }
  const vertex = new Vector3(), matrix = new Matrix4(), local = new Matrix4()
  let output = 0, sliceStarted = performance.now()
  for (const {mesh,source,ranges,instances,world} of meshes) {
    check()
    for (let instance = 0; instance < instances; instance++) {
      const sourceId=sourceNames.length
      if(sourceIds)sourceNames.push(String(mesh.userData.houseDesignerRole || mesh.name || mesh.geometry.name || 'Imported mesh'))
      matrix.copy(world)
      if (mesh instanceof InstancedMesh) { mesh.getMatrixAt(instance, local); matrix.multiply(local) }
      const mirrored = matrix.determinant() < 0
      for (const range of ranges) {
        const material=range.material
        let id = materialIds.get(material)
        if (id === undefined) {
          id = materials.length; materialIds.set(material, id)
          if (material.vertexColors) report('vertex or instance colour')
          if (material.alphaMap || material.alphaTest > 0 || material.transparent) report('non-glazing opacity')
          const entry: ReferenceMaterial = { color: [material.color.r, material.color.g, material.color.b],
            metalness: material.metalness, ...sampler(material.map) }
          if (material.metalnessMap && material.metalness > 0) {
            if (options.diffusePbr) {
              entry.metalnessTexture = sampler(material.metalnessMap)
              metalnessUVs ??= new Float32Array(uvs.length)
            } else report('metalness texture')
          }
          if (material.emissiveIntensity > 0 && Math.max(...material.emissive.toArray()) > 0) {
            if (options.diffusePbr) {
              const { r, g, b } = material.emissive
              entry.emission = [r * material.emissiveIntensity, g * material.emissiveIntensity, b * material.emissiveIntensity]
              if (material.emissiveMap) {
                entry.emissionTexture = sampler(material.emissiveMap)
                emissionUVs ??= new Float32Array(uvs.length)
              }
            } else report('mesh emission')
          }
          materials.push(entry)
        }
        const uvFor = (map: Texture | null) => source.attributes[map?.channel ? `uv${map.channel}` : 'uv']
        const uv = uvFor(material.map)
        const metalUV = materials[id].metalnessTexture ? uvFor(material.metalnessMap) : null
        const emitUV = materials[id].emissionTexture ? uvFor(material.emissiveMap) : null
        const end=range.start+(range.indices?.length??range.count)
        for (let triangle = range.start; triangle + 2 < end; triangle += 3) {
          // One imported fixture can contain more triangles than the rest of a
          // storey. Yield inside its range as well as between source meshes.
          if (options.interactive && (triangle - range.start) % 6144 === 0 && performance.now() - sliceStarted > 5) {
            await new Promise(resolve => setTimeout(resolve, 0))
            check()
            sliceStarted = performance.now()
          }
          if(sourceIds)sourceIds[output/3]=sourceId
          materialIndices[output / 3] = id
          if(sourceCategories)sourceCategories[output/3]=classifyTriangle!(mesh,triangle/3)
          for (let corner = 0; corner < 3; corner++) {
            const j = mirrored && corner ? 3 - corner : corner, index = range.indices?.[triangle-range.start+j] ?? source.index?.getX(triangle + j) ?? triangle + j
            vertex.fromBufferAttribute(source.attributes.position, index).applyMatrix4(matrix).toArray(positions, output * 3)
            uvs[output * 2] = uv?.getX(index) ?? 0; uvs[output * 2 + 1] = uv?.getY(index) ?? 0
            if (metalUV) { metalnessUVs![output * 2] = metalUV.getX(index); metalnessUVs![output * 2 + 1] = metalUV.getY(index) }
            if (emitUV) { emissionUVs![output * 2] = emitUV.getX(index); emissionUVs![output * 2 + 1] = emitUV.getY(index) }
            output++
          }
        }
      }
    }
    if (!options.interactive || performance.now() - sliceStarted > 5) {
      await new Promise(resolve => setTimeout(resolve, 0))
      sliceStarted = performance.now()
    }
  }
  const textures: ReferenceTexture[] = [], reader = options.imageReader ?? createDiffuseImageReader()
  const snapshotGeometryMs=performance.now()-started-extractionMs-simplificationMs
  const textureStarted=performance.now()
  const { scene, camera, material } = reader
  try {
    if (textureList.length && !options.interactive) { material.uniforms.source.value = textureList[0]; await gl.compileAsync(scene, camera) }
    const readTexture = async (texture: Texture, index: number) => {
      check()
      if (!options.interactive) s.scene.userData.referenceMeasurementProgress = { stage: 'reference texture', index, total: textureList.length }
      const image = texture.image as { width: number; height: number }
      const key = [texture.version, texture.source.version, texture.colorSpace, texture.flipY, texture.format, texture.type].join('/')
      const cached = options.interactive?.textureCache.get(texture)
      if (cached?.key === key) return cached.value
      const fallback = () => {
        report('unreadable diffuse texture')
        return { width: 1, height: 1, pixels: new Uint16Array(4).fill(DataUtils.toHalfFloat(1)) }
      }
      if (!image?.width || !image.height) {
        if (!options.interactive) throw Error('Missing original reference texture dimensions: ' + texture.name)
        return fallback()
      }
      const scale = Math.min(1, (options.textureLimit ?? Infinity) / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale))
      if (scale < 1) resizedTextures++
      const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthBuffer: false })
      try {
        const restoredTarget = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel(), clear = gl.autoClear
        material.uniforms.source.value = texture
        const pixels = new Uint16Array(width * height * 4)
        const readback = (() => {
          try {
            gl.autoClear = true; gl.setRenderTarget(target); gl.render(scene, camera)
            return gl.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels)
          } finally { gl.setRenderTarget(restoredTarget, face, mip); gl.autoClear = clear }
        })()
        await readback
        if (pixels.some(value => !Number.isFinite(DataUtils.fromHalfFloat(value)))) throw Error('Invalid reference texture readback')
        const value = { width, height, pixels }
        options.interactive?.textureCache.set(texture, { key, value })
        return value
      } catch (error) {
        if (!options.interactive) throw error
        return fallback()
      } finally { target.dispose() }
    }
    // Keep a small number of independent pixel-pack buffers in flight.
    // Starting each read restores the render target before yielding.
    const batch = options.interactive ? 4 : 1
    for (let i = 0; i < textureList.length; i += batch) {
      textures.push(...await Promise.all(textureList.slice(i, i + batch).map((texture, offset) => readTexture(texture, i + offset))))
    }
    if(options.interactive){
      check()
      for(const {mesh,source,instances,world,ranges} of meshes){
        let root:Object3D=mesh
        while(root.parent)root=root.parent
        if(root!==s.scene || mesh.geometry!==source || !mesh.matrixWorld.equals(world) ||
          (mesh instanceof InstancedMesh && mesh.count!==instances))throw new DiffuseSnapshotChanged()
        const current=indirectMaterialRanges(mesh)
        if(current.length!==ranges.length || current.some((r,i)=>r.start!==ranges[i].start || r.count!==ranges[i].count || r.material!==ranges[i].material))throw new DiffuseSnapshotChanged()
      }
    }
    const data: ReferenceSceneData = { positions, uvs, materialIndices, materials, textures, metalnessUVs, emissionUVs,
      ...readDiffuseSceneLighting(s.scene) }
    return { data:{...data,...(sourceIds?{sourceIds,sourceNames}:{}),...(sourceCategories?{sourceCategories}:{})}, snapshotMs: performance.now() - started,
      phases:{extractionMs,simplificationMs,snapshotGeometryMs,materialsMs:performance.now()-textureStarted}, triangles: count / 3, originalTriangles,reducedRanges, materials: materials.length, textures: textures.length,
      textureBytes: textures.reduce((sum, texture) => sum + texture.pixels.byteLength, 0), resizedTextures,
      unsupported: Object.fromEntries(unsupported) }
  } finally { if (!options.imageReader) reader.dispose() }
}

export type DiffuseSceneLighting = Pick<ReferenceSceneData, 'sunDirection' | 'sunIrradiance' | 'skyBase' | 'skyMode' | 'skySun' | 'daylightGain' | 'lights'>

export function classifyDiffuseSurface(mesh: Mesh) {
  let flags = /wall-engine|room-floor|room-ceiling|slab|roof|skirting/.test(String(mesh.userData.houseDesignerRole)) ? 2 : 0
  for (let node: Object3D | null = mesh; node; node = node.parent) {
    if (node.userData.indirectStairModel || /frame|window|door|portal|reveal/i.test(node.name + ' ' + node.userData.houseDesignerRole))
      flags |= 1
  }
  return flags
}

export function diffuseSceneTransferList(data: ReferenceSceneData) {
  const arrays = [data.positions, data.uvs, data.materialIndices, ...data.textures.map(texture => texture.pixels),
    data.sourceCategories, data.metalnessUVs, data.emissionUVs]
  return arrays.flatMap(array => array ? [array.buffer as ArrayBuffer] : [])
}

export function readDiffuseSceneLighting(scene: Scene, daylightGain?: number): DiffuseSceneLighting {
  let sun: DirectionalLight | undefined
  const lights: ReferenceLight[] = []
  scene.traverseVisible(object => {
    if (object instanceof DirectionalLight && object.userData.houseDesignerRole === 'sun-light') sun = object
    if ((object instanceof PointLight || object instanceof SpotLight) && object.intensity > 0) lights.push({
      position: object.getWorldPosition(new Vector3()).toArray(), color: [object.color.r, object.color.g, object.color.b], intensity: object.intensity,
      distance: object.distance, decay: object.decay,
      ...(object instanceof SpotLight ? { direction: object.target.getWorldPosition(new Vector3()).sub(object.getWorldPosition(new Vector3())).normalize().toArray(),
        cone: Math.cos(object.angle), penumbra: Math.cos(object.angle * (1 - object.penumbra)) } : {}),
    })
  })
  const uniforms = scene.userData.getIndirectUniforms(), gain = daylightGain ?? scene.userData.getBakedIndirectLighting?.()?.settings.daylightBounceStrength ?? uniforms.hdSkyRadianceBase.value.x / .65
  return {
    skyBase: uniforms.hdSkyRadianceBase.value.toArray(), skySun: uniforms.hdSkyDisplaySunIrradiance.value.clone().multiplyScalar(gain).toArray(),
    skyMode: uniforms.hdSkyMode.value > 1.5 ? 'overcast' : 'clear',
    sunDirection: sun ? sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3())).normalize().toArray() : [0, 1, 0],
    sunIrradiance: sun ? sun.color.toArray().map(value => value * sun!.intensity) as [number, number, number] : [0, 0, 0], daylightGain: gain, lights }
}
