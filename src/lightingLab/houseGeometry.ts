import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3 } from 'three'
import { SAH, MeshBVH, getBVHExtremes, type SerializedBVH } from 'three-mesh-bvh'
import { mapHouseDisplay, solidDoorProxy } from './houseProxies.ts'

export type HousePart = { name?: string; position: Float32Array; normal?: Float32Array; uv?: Float32Array; index?: Uint32Array;
  ranges: { start: number; count: number; material: number; back?: boolean }[]; matrices: number[][]; structural: boolean; planarDetail?: boolean;
  geometryKey?: string; lightingProxy?: 'solid-door-leaf' | 'coarse-model' | 'shared-detail'; transport?: HousePart }
export const HOUSE_TILE = 16, HOUSE_COLUMNS = 32, HOUSE_MAX_CARDS = 8192
export type HouseCard = { name?: string; centre: number[]; radius: number; area: number; start: number; count: number }
export type HouseSurfaceGeometry = { position: Float32Array; normal: Float32Array; uv: Float32Array; chart: Float32Array;
  vertexLightChart: Float32Array; vertexLighting: Float32Array;
  groups: { start: number; count: number; material: number }[] }
export type HouseGeometry = HouseSurfaceGeometry & { depth: Float32Array; display?: HouseSurfaceGeometry; proxyInstances?: number; proxyGeometries?: number; sharedDetailInstances?: number; preparationMs?: number;
  cards: HouseCard[]; tree: SerializedBVH; bvhStackDepth: number; width: number; height: number }
type CaptureChart = { axis: number; sign: number; area: number; planar: boolean; vertices: number[]; lo: Vector3; hi: Vector3 }

/** Detect actual overlapping receivers, rather than subdividing every sloping
 * surface merely because its depth varies. Samples compare depth at the same
 * projected point; tiny triangles also contribute a centroid coverage sample. */
function overlappingCapture(record: CaptureChart, position: Float32Array) {
  const size=16,u=(record.axis+1)%3,v=(record.axis+2)%3
  const width=Math.max(record.hi.getComponent(u)-record.lo.getComponent(u),1e-6),height=Math.max(record.hi.getComponent(v)-record.lo.getComponent(v),1e-6)
  const minimum=new Float64Array(size*size).fill(Infinity),maximum=new Float64Array(size*size).fill(-Infinity)
  const add=(x:number,y:number,z:number)=>{const id=Math.max(0,Math.min(size-1,y))*size+Math.max(0,Math.min(size-1,x));minimum[id]=Math.min(minimum[id],z);maximum[id]=Math.max(maximum[id],z);return maximum[id]-minimum[id]>.08}
  for(let at=0;at<record.vertices.length;at+=3){
    const points=record.vertices.slice(at,at+3).map(id=>[(position[id*3+u]-record.lo.getComponent(u))/width*size,(position[id*3+v]-record.lo.getComponent(v))/height*size,position[id*3+record.axis]])
    const [a,b,c]=points,denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if(Math.abs(denominator)<1e-10)continue
    let covered=false
    const loX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),hiX=Math.min(size-1,Math.floor(Math.max(...points.map(p=>p[0]))))
    const loY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),hiY=Math.min(size-1,Math.floor(Math.max(...points.map(p=>p[1]))))
    for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
      const wa=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/denominator
      const wb=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/denominator,wc=1-wa-wb
      if(Math.min(wa,wb,wc)<-1e-7)continue
      covered=true;if(add(x,y,a[2]*wa+b[2]*wb+c[2]*wc))return true
    }
    if(!covered&&add(Math.floor((a[0]+b[0]+c[0])/3),Math.floor((a[1]+b[1]+c[1])/3),(a[2]+b[2]+c[2])/3))return true
  }
  return false
}

/** A directional projection cannot represent two surfaces at different depths.
 * Split concave/imported meshes into depth bands before allocating atlas charts.
 * Keep triangles intact; a single sloping triangle is already unambiguous. */
function separateCaptureLayers(record: CaptureChart, position: Float32Array, thinDetail = false): CaptureChart[] {
  if (record.vertices.length <= 3) return [record]
  const triangles: { at: number; depth: number }[] = []
  for (let at=0;at<record.vertices.length;at+=3) {
    const depth=(position[record.vertices[at]*3+record.axis]+position[record.vertices[at+1]*3+record.axis]+position[record.vertices[at+2]*3+record.axis])/3
    triangles.push({at,depth})
  }
  triangles.sort((a,b)=>a.depth-b.depth)
  if (triangles[triangles.length-1].depth-triangles[0].depth <= .12) return [record]
  // Thin mouldings can fall between every overlap-test sample; their explicit
  // detail flag keeps the depth separation even when the coarse test misses.
  if (!thinDetail && !overlappingCapture(record,position)) return [record]
  const middle=Math.floor(triangles.length/2),point=new Vector3()
  return [triangles.slice(0,middle),triangles.slice(middle)].flatMap(triangles=>{
    const split:CaptureChart={...record,vertices:[],lo:new Vector3(Infinity,Infinity,Infinity),hi:new Vector3(-Infinity,-Infinity,-Infinity)}
    for(const {at} of triangles)for(let v=0;v<3;v++){
      const id=record.vertices[at+v];split.vertices.push(id);point.fromArray(position,id*3);split.lo.min(point);split.hi.max(point)
    }
    return separateCaptureLayers(split,position,thinDetail)
  })
}

/** Worker-side projection charts and acceleration structure. Architecture is
 * split by plane; curved/imported objects use six directional capture charts.
 * Concave overlapping furniture layers remain a known capture approximation. */
export function prepareHouseGeometry(parts: HousePart[], progress: (message: string) => void): HouseGeometry {
  const cache = new Map<string | HousePart, HousePart | undefined>()
  let proxyInstances = 0, proxyGeometries = 0
  const transport = parts.map(part => {
    if (!part.lightingProxy) return part
    const key = part.geometryKey ? `${part.geometryKey}:${part.transport?.ranges.reduce((sum, range) => sum + range.count, 0) ?? 'solid'}` : part
    if (!cache.has(key)) { const generated = part.transport ?? (part.lightingProxy === 'solid-door-leaf' ? solidDoorProxy(part) : undefined); cache.set(key, generated); if (generated) proxyGeometries++ }
    const proxy = cache.get(key)
    if (!proxy) return part
    proxyInstances += part.matrices.length
    return { ...proxy, matrices: part.matrices, ranges: proxy.ranges.map((range, i) => ({ ...range, material: part.ranges[i].material })) }
  })
  // A scene consisting solely of a small object still needs a receiver.
  if (!transport.some(part => part.ranges.some(range => range.count))) return prepareHouseCapture(parts, progress)
  const data = prepareHouseCapture(transport, progress)
  if (proxyInstances) {
    progress('Sharing coarse lighting with detailed display models')
    data.display = mapHouseDisplay(parts, transport, data)
    data.proxyInstances = proxyInstances; data.proxyGeometries = proxyGeometries
    data.sharedDetailInstances = transport.reduce((sum, part) => sum + (part.ranges.every(range => range.count === 0) ? part.matrices.length : 0), 0)
  }
  return data
}

function prepareHouseCapture(parts: HousePart[], progress: (message: string) => void): HouseGeometry {
  const count = parts.reduce((sum, p) => sum + p.matrices.length * p.ranges.reduce((s, r) => s + Math.floor(r.count / 3) * 3, 0), 0)
  if (!count || count > 4500000) throw Error('This experiment supports a non-empty scene up to 1.5 million triangles.')
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), chart = new Float32Array(count * 2), depth = new Float32Array(count)
  const vertexLightChart = new Float32Array(count*2),vertexLighting = new Float32Array(count)
  const groups: HouseGeometry['groups'] = [], cards: HouseCard[] = []
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), edge = new Vector3(), vertexNormal = new Vector3()
  let cursor = 0
  for (const part of parts) for (const transform of part.matrices) {
    const matrix = new Matrix4().fromArray(transform), nm = new Matrix3().getNormalMatrix(matrix), mirrored = matrix.determinant() < 0
    const principalNormals = part.planarDetail ? [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(axis=>axis.applyMatrix3(nm).normalize()) : []
    for (const range of part.ranges) {
      const start = cursor
      const charts = new Map<string, CaptureChart>()
      for (let t = range.start; t + 2 < range.start + range.count; t += 3) {
        const flip = mirrored !== !!range.back
        const ids = [0, flip ? 2 : 1, flip ? 1 : 2].map(offset => part.index?.[t + offset] ?? t + offset)
        a.fromArray(part.position, ids[0] * 3).applyMatrix4(matrix); b.fromArray(part.position, ids[1] * 3).applyMatrix4(matrix); c.fromArray(part.position, ids[2] * 3).applyMatrix4(matrix)
        n.copy(b).sub(a).cross(edge.copy(c).sub(a))
        const triangleArea = n.length() / 2
        n.normalize()
        const axis = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : (Math.abs(n.y) > Math.abs(n.z) ? 1 : 2)
        const sign = n.getComponent(axis) < 0 ? -1 : 1
        // A merged architectural mesh can span many rooms; six projections alone
        // would overwrite interior mouldings with the outermost captured face.
        // Door-frame rebates contain several parallel planes. Six projections
        // overwrite those receivers with a different layer, often inside a wall.
        // Split their principal faces, retaining compact charts for bevels.
        const planar = part.structural || principalNormals.some(axis => Math.abs(n.dot(axis)) > .999)
        const plane = planar ? Math.round(n.dot(a) * 100) + ':' + n.toArray().map(v => Math.round(v * 100)).join(',') : ''
        const key = `${axis}:${sign}:${plane}`
        let record = charts.get(key)
        if (!record) { record = { axis, sign, area: 0, planar, vertices: [], lo: new Vector3(Infinity, Infinity, Infinity), hi: new Vector3(-Infinity, -Infinity, -Infinity) }; charts.set(key, record) }
        record.area += triangleArea
        for (let v = 0; v < 3; v++) {
          const p = [a, b, c][v], id = ids[v]
          position.set(p.toArray(), cursor * 3)
          vertexNormal.copy(n)
          if (part.normal) { vertexNormal.fromArray(part.normal, id * 3).applyMatrix3(nm).normalize(); if (range.back) vertexNormal.negate() }
          normal.set(vertexNormal.toArray(), cursor * 3)
          if (part.uv) uv.set(part.uv.subarray(id * 2, id * 2 + 2), cursor * 2)
          record.lo.min(p); record.hi.max(p); record.vertices.push(cursor++)
        }
      }
      if (part.planarDetail && !part.structural) {
        // Reserve detail for the broad frame faces. Tiny rebates/mitres must not
        // consume hundreds of charts per door in a furnished house.
        const keep = new Set([...charts.entries()].filter(([,r])=>r.planar).sort((a,b)=>b[1].area-a[1].area).slice(0,12).map(([key])=>key))
        for (const [key, record] of [...charts.entries()]) {
          if (!record.planar || keep.has(key)) continue
          charts.delete(key)
          const fallback = `${record.axis}:${record.sign}:`, existing = charts.get(fallback)
          if (!existing) { record.planar = false; charts.set(fallback,record) }
          else { existing.vertices.push(...record.vertices); existing.lo.min(record.lo); existing.hi.max(record.hi); existing.area += record.area }
        }
      }
      groups.push({ start, count: cursor - start, material: range.material })
      const captures = part.structural ? [...charts.values()] : [...charts.values()].flatMap(record=>separateCaptureLayers(record,position,part.planarDetail))
      for (const record of captures) {
        if (cards.length >= HOUSE_MAX_CARDS) throw Error(`The snapshot exceeds ${HOUSE_MAX_CARDS} surface charts. Try a smaller house or fewer furnishings.`)
        const id = cards.length, u = (record.axis + 1) % 3, v = (record.axis + 2) % 3
        const extent = record.hi.clone().sub(record.lo)
        // A hinge must not receive as many ray samples as a room wall. Charts
        // retain fixed atlas slots, but small surfaces occupy fewer texels.
        // Keep at least four interior texels: one-pixel-wide captures can miss
        // thin mouldings entirely under the rasterizer's edge coverage rules.
        const width = Math.max(7, Math.min(HOUSE_TILE, Math.ceil(extent.getComponent(u) / .15) + 3))
        const height = Math.max(7, Math.min(HOUSE_TILE, Math.ceil(extent.getComponent(v) / .15) + 3))
        for (const vertex of record.vertices) {
          const x = (position[vertex * 3 + u] - record.lo.getComponent(u)) / Math.max(extent.getComponent(u), .0001)
          const y = (position[vertex * 3 + v] - record.lo.getComponent(v)) / Math.max(extent.getComponent(v), .0001)
          // One-texel margin leaves room for interpolation at triangle edges.
          chart[vertex * 2] = (id % HOUSE_COLUMNS) * HOUSE_TILE + 1.5 + x * (width - 3)
          chart[vertex * 2 + 1] = Math.floor(id / HOUSE_COLUMNS) * HOUSE_TILE + 1.5 + y * (height - 3)
          const z = (position[vertex * 3 + record.axis] - record.lo.getComponent(record.axis)) / Math.max(extent.getComponent(record.axis), .001)
          depth[vertex] = record.sign > 0 ? 1 - z : z
        }
        cards.push({ name: part.name, centre: record.lo.clone().add(record.hi).multiplyScalar(.5).toArray(), radius: extent.length() / 2,
          area: extent.getComponent(u) * extent.getComponent(v), start: record.vertices[0], count: record.vertices.length })
      }
      // Imported curved surfaces need continuous reconstruction across atlas
      // seams. Vertices sharing position AND shading normal use one receiver;
      // hard edges remain separate, and architectural charts retain texel detail.
      if (!part.structural) {
        const shared = new Map<string,number>()
        for(let vertex=start;vertex<cursor;vertex++){
          const key=[...position.subarray(vertex*3,vertex*3+3)].map(v=>Math.round(v*1e5)).join(',')+':'+[...normal.subarray(vertex*3,vertex*3+3)].map(v=>Math.round(v*1e3)).join(',')
          const owner=shared.get(key)??vertex;shared.set(key,owner)
          vertexLightChart[vertex*2]=chart[owner*2];vertexLightChart[vertex*2+1]=chart[owner*2+1];vertexLighting[vertex]=1
        }
      }
    }
  }
  progress(`Building ray lookup for ${Math.round(cursor / 3).toLocaleString()} triangles`)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3))
  const bvh = new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 4 })
  // The traversal pushes two children after popping their parent. Reserve
  // the measured maximum depth plus two slots rather than a generic 60.
  const bvhStackDepth = Math.max(...getBVHExtremes(bvh).map(root => root.depth.max)) + 2
  const tree = MeshBVH.serialize(bvh, { cloneBuffers: false })
  geometry.dispose()
  return { position, normal, uv, chart, depth, vertexLightChart, vertexLighting, groups, cards, tree, bvhStackDepth, width: HOUSE_COLUMNS * HOUSE_TILE, height: Math.ceil(cards.length / HOUSE_COLUMNS) * HOUSE_TILE }
}
