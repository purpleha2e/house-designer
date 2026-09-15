import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Object3D } from 'three'

// Original meshes remain the authoritative pick/collision/transform objects.
const batchedSources = new WeakSet<Object3D>()
export const isBatchedModelSource = (object: Object3D) => batchedSources.has(object)

type Member = { mesh: Mesh; modelId: string }
type Batch = { mesh: InstancedMesh; members: Member[]; capacity: number }

function visibleInHierarchy(object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

function hasOrthogonalAxes(matrix: Matrix4) {
  // Three's instance normal transform supports non-uniform scale, but not shear.
  const e = matrix.elements
  const lengths = [0, 4, 8].map(i => Math.hypot(e[i], e[i + 1], e[i + 2]))
  if (lengths.some(length => length < 1e-8)) return false
  return [[0, 1], [0, 2], [1, 2]].every(([a, b]) => {
    const i = a * 4, j = b * 4
    return Math.abs(e[i] * e[j] + e[i + 1] * e[j + 1] + e[i + 2] * e[j + 2]) < lengths[a] * lengths[b] * 1e-6
  })
}

function batchKey(mesh: Mesh) {
  if (mesh.children.length || 'isSkinnedMesh' in mesh || 'isInstancedMesh' in mesh ||
    mesh.morphTargetInfluences?.length || mesh.customDepthMaterial || mesh.customDistanceMaterial ||
    !hasOrthogonalAxes(mesh.matrixWorld)) return null
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  // Preserve transparent-object sorting and both passes for glass panes.
  if (materials.some(m => !m.visible || m.transparent || ('transmission' in m && Number(m.transmission) > 0) ||
    (!('isMeshStandardMaterial' in m) && !('isMeshBasicMaterial' in m)))) return null
  let parent = mesh.parent
  while (parent && !('isGroup' in parent)) parent = parent.parent
  if (parent?.renderOrder) return null
  return JSON.stringify([mesh.geometry.uuid, materials.map(m => m.uuid), mesh.castShadow,
    mesh.receiveShadow, mesh.frustumCulled, mesh.renderOrder, mesh.layers.mask, mesh.matrixWorld.determinant() < 0])
}

/** Shares draw submissions without changing the editable imported model hierarchy. */
export class ImportedModelBatching {
  readonly group = new Group()
  private roots = new Map<Object3D, string>()
  private batches = new Map<string, Batch>()
  private hidden = new Set<Mesh>()
  private matrix = new Matrix4()
  private reflection = new Matrix4().makeScale(-1, 1, 1)

  constructor() {
    this.group.name = 'Imported model render batches'
    this.group.userData.houseDesignerRole = 'model-batches'
  }

  register(root: Object3D, modelId: string) {
    this.roots.set(root, modelId)
    root.userData.houseDesignerBatchModelId = modelId
    return () => {
      this.roots.delete(root)
      delete root.userData.houseDesignerBatchModelId
      // Unmount/asset replacement must release all references to the old asset.
      this.reset()
    }
  }

  private restoreSources() {
    for (const mesh of this.hidden) {
      mesh.visible = true
      batchedSources.delete(mesh)
    }
    this.hidden.clear()
  }

  reset() {
    this.restoreSources()
    for (const batch of this.batches.values()) {
      this.group.remove(batch.mesh)
      batch.mesh.dispose() // Shared GLTF geometry and materials are not owned here.
    }
    this.batches.clear()
  }

  update() {
    this.restoreSources()
    const groups = new Map<string, Member[]>()
    for (const [root, modelId] of this.roots) {
      if (!root.parent || !visibleInHierarchy(root)) continue
      root.updateWorldMatrix(true, true)
      root.traverseVisible(object => {
        if (!(object instanceof Mesh)) return
        const key = batchKey(object)
        if (!key) return
        const members = groups.get(key) ?? []
        members.push({ mesh: object, modelId })
        groups.set(key, members)
      })
    }
    for (const [key, members] of groups) {
      if (members.length < 2) continue
      let batch = this.batches.get(key)
      if (!batch || batch.capacity < members.length) {
        if (batch) { this.group.remove(batch.mesh); batch.mesh.dispose() }
        const source = members[0].mesh
        const mesh = new InstancedMesh(source.geometry, source.material, members.length)
        mesh.name = source.name
        mesh.castShadow = source.castShadow
        mesh.receiveShadow = source.receiveShadow
        mesh.frustumCulled = source.frustumCulled
        mesh.renderOrder = source.renderOrder
        mesh.layers.mask = source.layers.mask
        // Keep instance determinants positive. The common reflection belongs on
        // the mesh so Three also sets winding correctly for mirrored placements.
        mesh.scale.x = source.matrixWorld.determinant() < 0 ? -1 : 1
        mesh.updateMatrixWorld()
        mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        mesh.userData.houseDesignerRole = 'model-batch'
        batch = { mesh, members: [], capacity: members.length }
        this.batches.set(key, batch)
        this.group.add(mesh)
      }
      const mesh = batch.mesh
      let changed = batch.members.length !== members.length
      members.forEach((member, index) => {
        this.matrix.copy(member.mesh.matrixWorld)
        if (mesh.scale.x < 0) this.matrix.premultiply(this.reflection)
        const array = mesh.instanceMatrix.array
        const offset = index * 16
        if (this.matrix.elements.some((value, i) => array[offset + i] !== Math.fround(value))) {
          mesh.setMatrixAt(index, this.matrix)
          changed = true
        }
        member.mesh.visible = false
        this.hidden.add(member.mesh)
        batchedSources.add(member.mesh)
      })
      mesh.count = members.length
      if (changed) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
      mesh.userData.modelIds = members.map(member => member.modelId)
      batch.members = members
    }
    for (const [key, batch] of this.batches) {
      if ((groups.get(key)?.length ?? 0) >= 2) continue
      this.group.remove(batch.mesh)
      batch.mesh.dispose()
      this.batches.delete(key)
    }
  }
}
