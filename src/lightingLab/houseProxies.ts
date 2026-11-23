import { BoxGeometry, BufferAttribute, BufferGeometry, Matrix3, Matrix4, Triangle, Vector2, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { HouseGeometry, HousePart, HouseSurfaceGeometry } from './houseGeometry'

/** Only the opaque leaf in these known library assets is eligible. A whole
 * doorway bounding box would close its opening; unknown/glazed assets retain
 * their original transport geometry. */
export function isSolidDoorLeaf(modelId: string, meshName: string) {
  return ['panel-interior-door-open', 'panel-interior-door-closed', 'panel-interior-door-open-low-detail',
    'panel-interior-door-full-open-low-detail', 'panel-interior-door-open-ultra'].includes(modelId)
    && /^doorBase_geo(?:$|[._])/.test(meshName)
}

export function solidDoorProxy(part: HousePart): HousePart | undefined {
  if (part.ranges.length !== 1 || part.ranges[0].back || part.ranges[0].count <= 36) return
  const range = part.ranges[0], triangles: { triangle: Triangle; ids: number[] }[] = []
  let largest = 0
  const z = new Vector3(), normal = new Vector3()
  for (let at = range.start; at + 2 < range.start + range.count; at += 3) {
    const ids = [0, 1, 2].map(i => part.index?.[at + i] ?? at + i)
    const triangle = new Triangle(...ids.map(id => new Vector3().fromArray(part.position, id * 3)) as [Vector3, Vector3, Vector3])
    const area = triangle.getArea()
    if (area > largest) { largest = area; triangle.getNormal(z) }
    triangles.push({ triangle, ids })
  }
  if (!largest || Math.abs(z.y) > .25) return
  const y = new Vector3(0, 1, 0).addScaledVector(z, -z.y).normalize(), x = y.clone().cross(z).normalize()
  const axes = [x, y, z], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const { triangle } of triangles) for (const p of [triangle.a, triangle.b, triangle.c]) axes.forEach((axis, i) => {
    const value = p.dot(axis); lo[i] = Math.min(lo[i], value); hi[i] = Math.max(hi[i], value)
  })
  const size = hi.map((value, i) => value - lo[i])
  if (size[2] <= 0 || size[2] > size[0] * .2 || size[1] < size[0] * 1.4) return
  const indexedBox = new BoxGeometry(...size as [number, number, number]), box = indexedBox.toNonIndexed()
  indexedBox.dispose()
  const position = new Float32Array(box.attributes.position.count * 3), normals = new Float32Array(position.length), uv = new Float32Array(position.length / 3 * 2)
  const p = new Vector3(), nearest = new Vector3(), candidate = new Vector3(), bary = new Vector3(), texel = new Vector2()
  for (let i = 0; i < position.length / 3; i++) {
    p.set(0, 0, 0); normal.set(0, 0, 0)
    axes.forEach((axis, c) => {
      p.addScaledVector(axis, box.attributes.position.getComponent(i, c) + (lo[c] + hi[c]) / 2)
      normal.addScaledVector(axis, box.attributes.normal.getComponent(i, c))
    })
    position.set(p.toArray(), i * 3); normals.set(normal.toArray(), i * 3)
    if (part.uv) {
      let best = Infinity, chosen = triangles[0]
      for (const source of triangles) {
        source.triangle.closestPointToPoint(p, candidate)
        const distance = candidate.distanceToSquared(p)
        if (distance < best) { best = distance; chosen = source; nearest.copy(candidate) }
      }
      chosen.triangle.getBarycoord(nearest, bary); texel.set(0, 0)
      chosen.ids.forEach((id, c) => texel.addScaledVector(new Vector2().fromArray(part.uv!, id * 2), bary.getComponent(c)))
      uv.set(texel.toArray(), i * 2)
    }
  }
  box.dispose()
  return { ...part, position, normal: normals, uv, index: undefined, structural: true,
    ranges: [{ ...range, start: 0, count: 36 }], lightingProxy: undefined }
}

/** Map detailed display triangles onto their transport receiver. Unmodified
 * parts copy their exact charts. Shared detail prefers similarly oriented
 * nearby receivers so a skirting front cannot inherit floor irradiance. */
export function mapHouseDisplay(parts: HousePart[], transport: HousePart[], data: HouseGeometry): HouseSurfaceGeometry {
  const count = parts.reduce((sum, p) => sum + p.matrices.length * p.ranges.reduce((n, r) => n + Math.floor(r.count / 3) * 3, 0), 0)
  const result: HouseSurfaceGeometry = { position: new Float32Array(count * 3), normal: new Float32Array(count * 3),
    uv: new Float32Array(count * 2), chart: new Float32Array(count * 2), vertexLightChart: new Float32Array(count * 2),
    vertexLighting: new Float32Array(count), groups: [] }
  let cursor = 0, groupIndex = 0
  let sharedGeometry: BufferGeometry | undefined, sharedTree: MeshBVH | undefined
  const centre = new Vector3(), closest = new Vector3(), bary = new Vector3(), lookup = new Vector2(), faceNormal = new Vector3(), query = new Vector3()
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex], proxy = part !== transport[partIndex]
    for (const transform of part.matrices) {
      const matrix = new Matrix4().fromArray(transform), normalMatrix = new Matrix3().getNormalMatrix(matrix)
      for (const range of part.ranges) {
        const sourceGroup = data.groups[groupIndex++], start = cursor
        if (!proxy) {
          for (const [key, width] of [['position', 3], ['normal', 3], ['uv', 2], ['chart', 2], ['vertexLightChart', 2], ['vertexLighting', 1]] as const)
            result[key].set(data[key].subarray(sourceGroup.start * width, (sourceGroup.start + sourceGroup.count) * width), cursor * width)
          cursor += sourceGroup.count
        } else {
          const sharedReceiver = sourceGroup.count === 0
          if (sharedReceiver && !sharedTree) {
            sharedGeometry = new BufferGeometry().setAttribute('position', new BufferAttribute(data.position, 3))
            sharedTree = MeshBVH.deserialize(data.tree, sharedGeometry)
          }
          const geometry = sharedReceiver ? sharedGeometry! : new BufferGeometry().setAttribute('position', new BufferAttribute(data.position.subarray(sourceGroup.start * 3, (sourceGroup.start + sourceGroup.count) * 3), 3))
          const tree = sharedReceiver ? sharedTree! : new MeshBVH(geometry)
          const faces = new Map<number, { ids: number[]; triangle: Triangle }>()
          const hit = { point: new Vector3(), distance: 0, faceIndex: 0 }
          const faceAt = (index: number) => {
            let face = faces.get(index)
            if (!face) {
              const ids = [0, 1, 2].map(v => (sharedReceiver ? 0 : sourceGroup.start) + geometry.index!.getX(index * 3 + v))
              face = { ids, triangle: new Triangle(...ids.map(id => new Vector3().fromArray(data.position, id * 3)) as [Vector3, Vector3, Vector3]) }
              faces.set(index, face)
            }
            return face
          }
          const receiverNormal = new Vector3(), receiverPoint = new Vector3()
          const nearest = (point: Vector3, normal: Vector3) => {
            query.copy(point).addScaledVector(normal, .00001)
            tree.closestPointToPoint(query, hit)
            let face = faceAt(hit.faceIndex)
            if (face.triangle.getNormal(receiverNormal).dot(normal) > .5) return face
            // Irradiance belongs to a surface orientation. At a floor/wall
            // junction, distance alone picks the floor for lower trim vertices
            // and the wall for upper ones, creating a false dark/bright band.
            // Door proxies have the same problem: a front-facing bottom vertex
            // can be closest to the unlit underside of the solid leaf.
            // Search only the local neighbourhood, never a remote room surface.
            let best = hit.distance + .25
            tree.shapecast({
              boundsTraverseOrder: box => box.distanceToPoint(query),
              intersectsBounds: box => box.distanceToPoint(query) <= best,
              intersectsTriangle: (triangle, index) => {
                if (triangle.getNormal(receiverNormal).dot(normal) <= .5) return false
                triangle.closestPointToPoint(query, receiverPoint)
                const distance = receiverPoint.distanceTo(query)
                if (distance < best) { best = distance; face = faceAt(index) }
                return false
              },
            })
            return face
          }
          const chartAt = (point: Vector3, face: ReturnType<typeof nearest>, planar = false) => {
            // Flat door panels can cross the proxy's triangulation diagonal.
            // Their affine chart must extend across that diagonal rather than
            // clamping distant vertices back onto the selected triangle.
            if (planar) closest.copy(point)
            else face.triangle.closestPointToPoint(point, closest)
            face.triangle.getBarycoord(closest, bary); lookup.set(0, 0)
            for (let c = 0; c < 3; c++) lookup.addScaledVector(new Vector2().fromArray(data.chart, face.ids[c] * 2), bary.getComponent(c))
            return lookup
          }
          const shared = new Map<number, number[]>()
          for (let at = range.start; at + 2 < range.start + range.count; at += 3) {
            const flip = (matrix.determinant() < 0) !== !!range.back
            const ids = [0, flip ? 2 : 1, flip ? 1 : 2].map(i => part.index?.[at + i] ?? at + i)
            const points = ids.map(id => new Vector3().fromArray(part.position, id * 3).applyMatrix4(matrix))
            const original = new Triangle(...points as [Vector3, Vector3, Vector3]); original.getMidpoint(centre); original.getNormal(faceNormal)
            const chosen = nearest(centre, faceNormal)
            const planarDoor = part.lightingProxy === 'solid-door-leaf' && faceNormal.dot(chosen.triangle.getNormal(receiverNormal)) > .999
            for (let v = 0; v < 3; v++) {
              result.position.set(points[v].toArray(), cursor * 3)
              const n = part.normal ? new Vector3().fromArray(part.normal, ids[v] * 3).applyMatrix3(normalMatrix).normalize() : faceNormal.clone()
              if (part.normal && range.back) n.negate()
              result.normal.set(n.toArray(), cursor * 3)
              if (part.uv) result.uv.set(part.uv.subarray(ids[v] * 2, ids[v] * 2 + 2), cursor * 2)
              result.chart.set(chartAt(points[v], chosen, planarDoor).toArray(), cursor * 2)
              if (planarDoor) {
                // Corner-only lighting can make a whole white door black when
                // its perimeter lies in shadow. Flat panels use the full cache.
                result.vertexLightChart.set(result.chart.subarray(cursor * 2, cursor * 2 + 2), cursor * 2)
                result.vertexLighting[cursor] = 0; cursor++; continue
              }
              // Shared vertices sample the same coarse receiver even when
              // adjoining display triangles map to different capture cards.
              let owner = shared.get(ids[v])
              if (!owner) { owner = chartAt(points[v], nearest(points[v], n)).toArray(); shared.set(ids[v], owner) }
              result.vertexLightChart.set(owner, cursor * 2); result.vertexLighting[cursor] = 1
              cursor++
            }
          }
          if (!sharedReceiver) geometry.dispose()
        }
        result.groups.push({ start, count: cursor - start, material: range.material })
      }
    }
  }
  sharedGeometry?.dispose()
  return result
}
