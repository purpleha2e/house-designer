import { BoxGeometry, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Triangle, Vector3, Vector4, type Scene } from 'three'
import type { FloorLevel, SurfaceMaterialAssignment, Wall, WallOpening } from './types.ts'
import { shaderWarmupGeneration } from './shaderWarmupState.ts'
import { getWallMaterialAssignmentForSide, getWallSurfaceMaterialAssignments, resolveWallEngineFinish } from './wallEngine/wallRenderPreparation.ts'
import { resolvedWallMaterialBatchKey, wallMaterialBatchKey } from './wallEngine/wallMaterialBatchKey.ts'

const MAX_OPENINGS = 32
type Preview = ReturnType<typeof createWallOpeningPreview>
const previews = new WeakMap<Scene, Preview>()
const hooked = new WeakMap<Material, Preview>()
// Prepared wall coordinates can differ from the authored values by a few ULPs.
// Those differences must not create a replacement box over the finished wall.
const sameLength = (a: number, b: number) => Math.abs(a - b) <= 1e-6
const sameWallStructure = (a: Wall, b: Wall) => a.id === b.id && a.kind === b.kind &&
  a.allowRoofClipHeight === b.allowRoofClipHeight &&
  sameLength(a.start.x, b.start.x) && sameLength(a.start.y, b.start.y) &&
  sameLength(a.end.x, b.end.x) && sameLength(a.end.y, b.end.y) &&
  sameLength(a.height, b.height) && sameLength(a.thickness, b.thickness)
const sameOpeningShape = (a?: WallOpening, b?: WallOpening) => a && b
  ? sameLength(a.center, b.center) && sameLength(a.bottom, b.bottom) &&
    sameLength(a.width, b.width) && sameLength(a.height, b.height)
  : a === b

/** A patch continues the nearest rendered finish on its own wall skin, including
 * fragment paints. The first material slot may belong to the opposite facade. */
export function findWallOpeningPreviewMaterial(mesh: Mesh, floor: FloorLevel, wall: Wall,
  opening: WallOpening, side: -1 | 1, assignments: SurfaceMaterialAssignment[]) {
  const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y, length = Math.hypot(dx, dz) || 1
  const normal = new Vector3(-dz / length * side, 0, dx / length * side)
  const point = new Vector3(wall.start.x + dx / length * opening.center + normal.x * wall.thickness / 2,
    floor.elevation + opening.bottom + opening.height / 2,
    wall.start.y + dz / length * opening.center + normal.z * wall.thickness / 2)
  mesh.updateWorldMatrix(true, false)
  const inverse = new Matrix4().copy(mesh.matrixWorld).invert()
  point.applyMatrix4(inverse); normal.transformDirection(inverse)
  const geometry = mesh.geometry, positions = geometry.attributes.position, normals = geometry.attributes.normal
  const triangle = new Triangle(), candidateNormal = new Vector3(), closest = new Vector3()
  let nearest: Material | undefined, distance = Infinity
  if (positions && normals) for (const group of geometry.groups) {
    const material = entries[group.materialIndex ?? 0]
    if (!material) continue
    const count = geometry.index?.count ?? positions.count
    for (let i = group.start; i + 2 < Math.min(group.start + group.count, count); i += 3) {
      const a = geometry.index?.getX(i) ?? i
      candidateNormal.fromBufferAttribute(normals, a)
      if (candidateNormal.dot(normal) < .99) continue
      triangle.a.fromBufferAttribute(positions, a)
      if (Math.abs(closest.copy(triangle.a).sub(point).dot(normal)) > .003) continue
      triangle.b.fromBufferAttribute(positions, geometry.index?.getX(i + 1) ?? i + 1)
      triangle.c.fromBufferAttribute(positions, geometry.index?.getX(i + 2) ?? i + 2)
      triangle.closestPointToPoint(point, closest)
      const next = closest.distanceToSquared(point)
      if (next < distance) { distance = next; nearest = material }
    }
  }
  if (nearest) return nearest
  const finish = resolveWallEngineFinish({ source: { wallId: wall.id, side, role: 'room-surface' },
    surfaceAssignments: assignments, wallsById: new Map([[wall.id, wall]]) })
  const assignment = finish.assignment ?? getWallMaterialAssignmentForSide(
    getWallSurfaceMaterialAssignments(assignments, wall.id), wall.height, side)
  const key = wallMaterialBatchKey(assignment, finish.fallback)
  const keys = mesh.userData.wallMaterialKeys as string[] | undefined
  // Prepared scenes can use either conservative worker keys or resolved finishes.
  const candidates = [resolvedWallMaterialBatchKey(assignment, finish.fallback, true),
    resolvedWallMaterialBatchKey(assignment, finish.fallback, true, false), key,
    resolvedWallMaterialBatchKey(assignment, finish.fallback, false)]
  const index = candidates.map(candidate => keys?.indexOf(candidate) ?? -1).find(index => index >= 0) ?? -1
  // Legacy single-material walls have no palette and no separate facade slot.
  return index >= 0 ? entries[index] : entries.length === 1 && !mesh.userData.wallMaterialKeys ? entries[0] : undefined
}

/** Opening edits have an immediate visual representation while the authoritative
 * wall/roof mesh is rebuilt. Fill the old void and cut the new void on the GPU;
 * no worker, shader compilation, or whole-scene preparation is required. */
function createWallOpeningPreview(scene: Scene) {
  const group = new Group(); group.userData.selectionDecoration = true
  group.userData.wallOpeningPreview = true
  const uniforms = { hdOpeningPreviewCount: { value: 0 }, hdOpeningPreviewOverlay: { value: 0 },
    hdOpeningPreviewA: { value: Array.from({ length: MAX_OPENINGS }, () => new Vector4()) },
    hdOpeningPreviewB: { value: Array.from({ length: MAX_OPENINGS }, () => new Vector4()) } }
  let floors: FloorLevel[] = [], assignments: SurfaceMaterialAssignment[] = [], revision = 0, prepared = ''
  const geometries = new Set<BoxGeometry>(), materials = new Set<Material>(), restores = new Set<() => void>()
  const clear = () => { group.clear(); geometries.forEach(g => g.dispose()); geometries.clear(); materials.forEach(m => m.dispose()); materials.clear(); uniforms.hdOpeningPreviewCount.value = 0 }
  const materialFor = (mesh: Mesh, floor: FloorLevel, wall: Wall, opening: WallOpening, side: -1 | 1) => {
    const material = findWallOpeningPreviewMaterial(mesh, floor, wall, opening, side, assignments)
    if (material) return material
    const fallback = new MeshStandardMaterial({ color: wall.kind === 'external' ? '#94a3b8' : '#cbd5e1' })
    materials.add(fallback)
    return fallback
  }
  const addBox = (mesh: Mesh, floor: FloorLevel, wall: Wall, opening: WallOpening, reveal: boolean) => {
    const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y, length = Math.hypot(dx, dz) || 1
    const ux = dx / length, uz = dz / length
    const geometry = new BoxGeometry(opening.width, opening.height, wall.thickness)
    if (reveal) { const groups = geometry.groups.slice(0, 4); geometry.clearGroups(); groups.forEach(g => geometry.addGroup(g.start, g.count, 0)) }
    // Preserve the wall's UV scale instead of stretching its finish over the patch.
    const p = geometry.attributes.position, uv = geometry.attributes.uv
    for (let i = 0; i < p.count; i++) uv.setXY(i, opening.center + p.getX(i), floor.elevation + opening.bottom + opening.height / 2 + p.getY(i))
    for (const name of ['uv1', 'uv2', 'uv3']) if (mesh.geometry.attributes[name]) geometry.setAttribute(name, uv.clone())
    const copies = new Map<Material, Material>()
    const copy = (original: Material) => {
      let material = copies.get(original)
      if (!material) {
        material = original.clone(); material.onBeforeCompile = (shader, renderer) => {
          original.onBeforeCompile(shader, renderer)
          shader.uniforms.hdOpeningPreviewOverlay = { value: 1 }
        }
        const key = original.customProgramCacheKey(); material.customProgramCacheKey = () => key
        if ('defaultAttributeValues' in original) Object.assign(material, { defaultAttributeValues: original.defaultAttributeValues })
        copies.set(original, material); materials.add(material)
      }
      return material
    }
    const front = copy(materialFor(mesh, floor, wall, opening, 1)), back = copy(materialFor(mesh, floor, wall, opening, -1))
    const patch = new Mesh(geometry, reveal ? front : [front, front, front, front, front, back])
    patch.position.set(wall.start.x + ux * opening.center, floor.elevation + opening.bottom + opening.height / 2, wall.start.y + uz * opening.center)
    patch.rotation.y = -Math.atan2(uz, ux); patch.receiveShadow = mesh.receiveShadow
    patch.renderOrder = mesh.renderOrder; group.add(patch); geometries.add(geometry)
  }
  const addCut = (floor: FloorLevel, wall: Wall, opening: WallOpening, oldWall = false) => {
    if (uniforms.hdOpeningPreviewCount.value >= MAX_OPENINGS) return
    const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y, length = Math.hypot(dx, dz) || 1
    const index = uniforms.hdOpeningPreviewCount.value++
    uniforms.hdOpeningPreviewA.value[index].set(wall.start.x + dx / length * opening.center, floor.elevation + opening.bottom, wall.start.y + dz / length * opening.center, opening.width / 2)
    uniforms.hdOpeningPreviewB.value[index].set(dx / length, dz / length, floor.elevation + opening.bottom + opening.height, (wall.thickness / 2 + .003) * (oldWall ? -1 : 1))
  }
  const wallBox = (wall: Wall): WallOpening => ({ id: '__preview-wall', modelId: '__preview-wall', center: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 2,
    width: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y), bottom: 0, height: wall.height })
  return {
    group, uniforms, restores,
    update(next: FloorLevel[], nextAssignments: SurfaceMaterialAssignment[]) { floors = next; assignments = nextAssignments; revision++ },
    sync(display: Scene = scene) {
      const key = `${display.uuid}:${revision}:${shaderWarmupGeneration(scene)}`
      if (key === prepared) return false
      prepared = key; clear()
      const handled = new Set<string>()
      display.traverse(object => {
        if (!(object instanceof Mesh) || !object.userData.wallOpeningPreviewEligible) return
        const floor = floors.find(floor => floor.id === object.userData.floorId)
        const beforeWalls = object.userData.wallPreparedWalls as Wall[] | undefined
        if (!floor || !beforeWalls) return
        for (const wallId of new Set([...floor.walls.map(wall => wall.id), ...beforeWalls.map(wall => wall.id)])) {
          const id = `${floor.id}:${wallId}`, before = beforeWalls.find(candidate => candidate.id === wallId), wall = floor.walls.find(candidate => candidate.id === wallId)
          if (handled.has(id)) continue
          handled.add(id)
          if (!before || !wall || !sameWallStructure(before, wall)) {
            if (before) addCut(floor, before, { ...wallBox(before), bottom: -.002, height: before.height + .004 }, true)
            if (wall) {
              addBox(object, floor, wall, wallBox(wall), false)
              for (const opening of wall.openings ?? []) { addCut(floor, wall, opening); addBox(object, floor, wall, opening, true) }
            }
            continue
          }
          const oldOpenings = new Map((before.openings ?? []).map(o => [o.id, o]))
          const nextOpenings = new Map((wall.openings ?? []).map(o => [o.id, o]))
          for (const openingId of new Set([...oldOpenings.keys(), ...nextOpenings.keys()])) {
            const a = oldOpenings.get(openingId), b = nextOpenings.get(openingId)
            if (sameOpeningShape(a, b)) continue
            if (uniforms.hdOpeningPreviewCount.value >= MAX_OPENINGS) break
            if (a) addBox(object, floor, wall, a, false)
            if (b) {
              addCut(floor, wall, b)
              addBox(object, floor, wall, b, true)
            }
          }
        }
      })
      group.updateMatrixWorld(true)
      return true
    },
    get active() { return group.children.length > 0 || uniforms.hdOpeningPreviewCount.value > 0 },
    dispose() { clear(); restores.forEach(restore => restore()); previews.delete(scene) },
  }
}

export function getWallOpeningPreview(scene: Scene) {
  let preview = previews.get(scene)
  if (!preview) { preview = createWallOpeningPreview(scene); previews.set(scene, preview) }
  return preview
}

export function applyWallOpeningPreviewShader(material: Material, scene: Scene) {
  if (!(material instanceof MeshStandardMaterial)) return
  const preview = getWallOpeningPreview(scene)
  if (hooked.get(material) === preview) return
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey
  const hook: Material['onBeforeCompile'] = (shader, renderer) => {
    compile.call(material, shader, renderer); Object.assign(shader.uniforms, preview.uniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 hdOpeningPreviewPosition;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdOpeningWorld=vec4(transformed,1.0);
        #ifdef USE_BATCHING
          hdOpeningWorld=batchingMatrix*hdOpeningWorld;
        #endif
        #ifdef USE_INSTANCING
          hdOpeningWorld=instanceMatrix*hdOpeningWorld;
        #endif
        hdOpeningPreviewPosition=(modelMatrix*hdOpeningWorld).xyz;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 hdOpeningPreviewPosition;
      uniform float hdOpeningPreviewCount,hdOpeningPreviewOverlay;
      uniform vec4 hdOpeningPreviewA[${MAX_OPENINGS}],hdOpeningPreviewB[${MAX_OPENINGS}];
      bool hdOpeningHidden(vec3 p) {
        for(int i=0;i<${MAX_OPENINGS};i++) {
          if(float(i)>=hdOpeningPreviewCount)break;
          vec4 a=hdOpeningPreviewA[i],b=hdOpeningPreviewB[i];vec2 d=p.xz-a.xz;
          if(b.w<0.0&&hdOpeningPreviewOverlay>.5)continue;
          if(abs(dot(d,b.xy))<a.w-.00001&&abs(dot(d,vec2(-b.y,b.x)))<abs(b.w)&&p.y>a.y+.00001&&p.y<b.z-.00001)return true;
        }
        return false;
      }`).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif(hdOpeningPreviewCount>.5&&hdOpeningHidden(hdOpeningPreviewPosition))discard;')
  }
  material.onBeforeCompile = hook; material.customProgramCacheKey = () => `${key.call(material)}:opening-preview-v1`
  material.needsUpdate = true; hooked.set(material, preview)
  const restore = () => {
    if (material.onBeforeCompile === hook) { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true }
    hooked.delete(material); preview.restores.delete(restore); material.removeEventListener('dispose', restore)
  }
  preview.restores.add(restore); material.addEventListener('dispose', restore)
}
