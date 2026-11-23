import { BackSide, BufferAttribute, DoubleSide, FrontSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Camera, type Color, type Scene, type Texture } from 'three'
import { isBatchedModelSource } from '../importedModelBatching'
import { hasViewportSurfaceVisibility } from '../viewportSurfaceVisibility'
import { isSelectionDecoration } from '../shaderWarmup'
import { isLightingGlazing } from '../lightingVisibility'
import type { IndirectLocalLight } from '../components/IndirectLighting'
import type { HousePart } from './houseGeometry'
import { LAB_SKY_COLOUR, LAB_SKY_RADIANCE } from './calibration'
import { isSolidDoorLeaf } from './houseProxies'

export type HouseFinish = { colour: number[]; emission: number[]; map: Texture | null; alphaTest: number; side: number; daylightEmitter?: boolean; glazing?: boolean;
  /** Authored PBR properties for the independent reference; never sent to the cache worker. */
  referenceMaterial?: MeshStandardMaterial }
export type HouseInput = { lights: IndirectLocalLight[]; sunDirection: number[]; sunColour: number[]; daylight: boolean }
export type HouseSnapshot = { parts: HousePart[]; finishes: HouseFinish[]; position: number[]; quaternion: number[]; fov: number; prototypeDaylight?: boolean;
  exterior?: { background: Texture | Color | null; backgroundIntensity: number; backgroundRotation: number[] } }
export type HouseBridge = { snapshot(options?: { prototypeDaylight?: boolean; referenceExterior?: boolean }): HouseSnapshot; lighting(): HouseInput }
declare global { interface Window { houseLightingSource?: HouseBridge } }

/** Called only by the explicit experiment button. The editor owns its scene;
 * the other tab receives copied geometry and uses independent GPU resources. */
export function openHouseLightingLab(scene: Scene, camera: Camera, lighting: () => HouseInput) {
  window.houseLightingSource = {
    lighting,
    snapshot: options => snapshotHouseMeshes(scene,camera,options),
  }
  window.open('/lighting-lab/index.html?house=1', '_blank')
}

export function snapshotHouseMeshes(scene:Scene, camera:Camera,
  options: {prototypeDaylight?:boolean; referenceExterior?:boolean} = {}):HouseSnapshot {
  scene.updateMatrixWorld(true)
  const parts: HousePart[] = [], finishes: HouseFinish[] = [], materialIds = new Map<MeshStandardMaterial | MeshBasicMaterial, number>()
  let background = scene.background
  const packed = (attribute: Mesh['geometry']['attributes'][string] | undefined, size: number) => {
    if (!attribute) return undefined
    if (attribute instanceof BufferAttribute && !attribute.normalized && attribute.itemSize === size) return Float32Array.from(attribute.array)
    const data = new Float32Array(attribute.count * size)
    for (let i = 0; i < attribute.count; i++) for (let c = 0; c < size; c++) data[i * size + c] = attribute.getComponent(i, c)
    return data
  }
  scene.traverse(object => {
    if (!(object instanceof Mesh) || isSelectionDecoration(object) || /model-batch/.test(String(object.userData.houseDesignerRole))) return
    let exteriorOpening = object.userData.exteriorSkyReceiver === true, lightingModelId = String(object.userData.lightingModelId ?? '')
    for (let p = object as Mesh['parent']; p; p = p.parent) {
      if ((!p.visible && !isBatchedModelSource(p) && !hasViewportSurfaceVisibility(p)) || p.userData.indirectLightModel) return
      exteriorOpening ||= p.userData.exteriorSkyReceiver === true || p.userData.houseDesignerRole === 'dormer-window'
      lightingModelId ||= String(p.userData.lightingModelId ?? '')
    }
    if (!object.visible && !isBatchedModelSource(object) && !hasViewportSurfaceVisibility(object)) return
    if (object.userData.houseDesignerRole === 'skybox') {
      if (options.referenceExterior && !Array.isArray(object.material) && 'map' in object.material && object.material.map) background = object.material.map as Texture
      return
    }
    if (!options.referenceExterior && /ground-image|floor-image/.test(String(object.userData.houseDesignerRole))) return
    const g = object.geometry, position = packed(g.attributes.position, 3)
    if (!position || object.type === 'SkinnedMesh') return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const count = g.index?.count ?? position.length / 3
    const ranges = (g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }]).flatMap((group: { start: number; count: number; materialIndex?: number }) => {
      const m = materials[Array.isArray(object.material) ? group.materialIndex ?? 0 : 0]
      if (!(m instanceof MeshStandardMaterial || options.referenceExterior && m instanceof MeshBasicMaterial) || !m.colorWrite || (!m.visible && !hasViewportSurfaceVisibility(m))) return []
      const glazing = isLightingGlazing(m), daylightEmitter = !options.referenceExterior && glazing && exteriorOpening && options.prototypeDaylight === true
      if (glazing && !daylightEmitter && !options.referenceExterior) return []
      let material = materialIds.get(m)
      if (material === undefined) {
        material = finishes.length; materialIds.set(m, material)
        const authored = m instanceof MeshStandardMaterial ? m.clone() : new MeshPhysicalMaterial({ color: m.color, map: m.map, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, roughness: 1, side: m.side })
        finishes.push(daylightEmitter ? { colour: [0,0,0], emission: LAB_SKY_COLOUR.map(v=>v*LAB_SKY_RADIANCE), map: null, alphaTest: 0, side: DoubleSide, daylightEmitter: true }
          : { colour: authored.color.toArray(), emission: authored.emissive.clone().multiplyScalar(authored.emissiveIntensity).toArray(), map: authored.map, alphaTest: authored.alphaTest, side: m.side === BackSide ? FrontSide : m.side, referenceMaterial: authored, glazing })
        if (daylightEmitter) authored.dispose()
      }
      const start = Math.max(group.start, g.drawRange.start), end = Math.min(count, group.start + group.count, g.drawRange.start + g.drawRange.count)
      return end > start ? [{ start, count: end - start, material, back: m.side === BackSide }] : []
    })
    if (!ranges.length) return
    const matrices: number[][] = []
    for (let i = 0; i < (object instanceof InstancedMesh ? object.count : 1); i++) {
      const matrix = object.matrixWorld.clone()
      if (object instanceof InstancedMesh) { const local = new Matrix4(); object.getMatrixAt(i, local); matrix.multiply(local) }
      matrices.push(matrix.toArray())
    }
    const structural = /wall|roof|ceiling|slab|floor|ground|skirting|architrave|moulding/.test(String(object.userData.houseDesignerRole))
    const decorativeTrim = /skirting|architrave|moulding/.test(String(object.userData.houseDesignerRole))
    const opaque = materials.every(m => m instanceof MeshStandardMaterial && m.opacity === 1 && m.alphaTest === 0 && !isLightingGlazing(m))
    parts.push({ name: `${object.name} ${object.userData.houseDesignerRole ?? ''}`, position, normal: packed(g.attributes.normal, 3), uv: packed(g.attributes.uv, 2), index: g.index ? Uint32Array.from(g.index.array) : undefined,
      ranges, matrices, structural,
      planarDetail: /door.?frame/i.test(object.name),
      geometryKey: `${g.uuid}:${ranges.map((r: {start: number; count: number; back?: boolean})=>`${r.start}:${r.count}:${r.back}`).join('|')}`,
      lightingProxy: decorativeTrim && opaque ? 'shared-detail' : isSolidDoorLeaf(lightingModelId, object.name) && materials.length === 1 && opaque ? 'solid-door-leaf'
        : lightingModelId && opaque && !structural && !exteriorOpening ? 'coarse-model' : undefined })
  })
  return { parts, finishes, position: camera.getWorldPosition(new Vector3()).toArray(), quaternion: camera.quaternion.toArray(), fov: 'fov' in camera ? Number(camera.fov) : 65, prototypeDaylight: options.prototypeDaylight === true && !options.referenceExterior,
    ...(options.referenceExterior ? { exterior: { background, backgroundIntensity: scene.backgroundIntensity, backgroundRotation: [scene.backgroundRotation.x, scene.backgroundRotation.y, scene.backgroundRotation.z] } } : {}) }
}
