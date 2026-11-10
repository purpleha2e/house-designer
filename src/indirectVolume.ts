import { Data3DTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector3 } from 'three'
import { INDIRECT_MASK_SIZE, type IndirectField } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'
import type {IndirectZoneChange} from './indirectLightingZones.ts'
import {indirectLocalFloorReceiver,indirectLocalWeight} from './indirectSpatialInterpolation.ts'
import {indirectContactKernel,indirectContactWeight,INDIRECT_CONTACT_RADIUS} from './indirectContactProbes.ts'

export const INDIRECT_VOLUME_HEIGHT = 12
export const INDIRECT_VOLUME_STRIDE = INDIRECT_VOLUME_HEIGHT + 2
export const INDIRECT_VOLUME_SAMPLING_VERSION = 1

/** Geometry-only interpolation. Illumination and probe validity stay on the GPU. */
export type IndirectInterpolationGraph = { offsets: Uint32Array; counts: Uint16Array; indices: Uint16Array; weights: Float32Array; supports?:Float32Array;supportOverrides?:{indices:Uint32Array;weights:Float32Array} }
export type IndirectInterpolationReuseData={layout:string;mask:Uint8Array;offsets:Uint32Array;counts:Uint16Array;indices:Uint16Array;weights:Float32Array;states:Uint8Array;localFloorCells?:Uint8Array;used:number;cells:number;readyStates:number;pendingChanges:IndirectZoneChange[]}
export type IndirectInterpolationReuse={previous:IndirectInterpolationReuseData;changes:IndirectZoneChange[]}

/** Finite segment / expanded edit bounds, independent of triangle ordering. */
function crossesEdit(ax:number,ay:number,az:number,bx:number,by:number,bz:number,box:IndirectZoneChange){
  let near=0,far=1
  for(let axis=0;axis<3;axis++){
    const a=axis===0?ax:axis===1?ay:az,b=axis===0?bx:axis===1?by:bz,d=b-a,min=box.min[axis]-.002,max=box.max[axis]+.002
    if(Math.abs(d)<1e-12){if(a<min||a>max)return false;continue}
    const t0=(min-a)/d,t1=(max-a)/d;near=Math.max(near,Math.min(t0,t1));far=Math.min(far,Math.max(t0,t1));if(far<near)return false
  }return true
}

/** The selected coefficient slabs share one texture; L0 alpha stores valid-sample coverage. */
export function createIndirectVolume(size: number, floors: number, spacing = .16, limit = 128, coefficientCount = 4) {
  const n = Math.max(2, Math.min(limit, Math.ceil(size / spacing) + 1))
  const height = Math.max(1, floors) * INDIRECT_VOLUME_STRIDE
  const data = new Uint16Array(n * n * height * coefficientCount * 4)
  const maps = [(() => {
    const texture = new Data3DTexture(data, n, height * coefficientCount, n)
    texture.type = HalfFloatType; texture.format = RGBAFormat; texture.colorSpace = NoColorSpace
    texture.magFilter = texture.minFilter = LinearFilter; texture.generateMipmaps = false
    texture.unpackAlignment = 1; texture.needsUpdate = true
    return texture
  })()]
  return { n, height, coefficientCount, data, maps, rows: n * floors * INDIRECT_VOLUME_HEIGHT,
    dispose() { maps.forEach(map => map.dispose()) } }
}

const origin = new Vector3(), direction = new Vector3()

/** Visibility depends on geometry, not illumination. Reuse it across previews and bounce passes. */
export function createIndirectVolumeLookup(field: IndirectField, visibility: IndirectVisibility, voxels = field.volume.rows * field.volume.n,reuse?:IndirectInterpolationReuse,floorLookup=false) {
  const counters={samples:0,newCells:0,reusedCells:0,retainedStates:0,invalidatedStates:0,candidateChecks:0,links:0,visibilityTests:0,visibleLinks:0,blockedLinks:0,blendedLinks:0,decodedValues:0,growthBytes:0}
  const bins = new Map<string, typeof field.probes>()
  for (const original of field.probes) {
    const probe = { ...original, position: new Vector3().fromArray(field.positionData, original.index * 4) }
    const key = `${Math.floor(probe.position.x / field.spacing)}:${Math.floor(probe.position.z / field.spacing)}`
    const bin = bins.get(key) ?? []; bin.push(probe); bins.set(key, bin)
  }
  const contacts=new Set(field.probes.filter(p=>p.kind==='contact').map(p=>p.index))
  const layout=JSON.stringify([field.spatialInterpolation,field.bounds,field.spacing,field.volume.n,field.floorLayer.n,field.ranges,field.floors.map(f=>[f.id,f.elevation]),voxels,field.probes.map(p=>[p.index,p.kind,...field.positionData.subarray(p.index*4,p.index*4+3)])])
  const mask=field.mask.image.data as Uint8Array,old=reuse?.previous
  const compatible=!!old&&!!reuse?.changes.length&&reuse.changes.every(b=>b.min.length===3&&b.max.length===3&&b.min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(b.max[i])&&v<=b.max[i]))&&old.layout===layout&&old.mask.length===mask.length&&mask.every((v,i)=>v===old.mask[i])
  const offsets = compatible ? old!.offsets : new Uint32Array(voxels).fill(0xffffffff)
  const counts = compatible ? old!.counts : new Uint16Array(voxels)
  let indices = compatible ? old!.indices : new Uint16Array(65536)
  let weights = compatible ? old!.weights : new Float32Array(65536)
  let states = compatible ? old!.states : new Uint8Array(65536), used = compatible ? old!.used : 0
  const checked=compatible?new Uint8Array(voxels):null
  const localFloorCells=floorLookup&&field.spatialInterpolation==='occluder-local'?(compatible?old!.localFloorCells:undefined)??new Uint8Array(voxels):undefined
  // A rapid edit may interrupt validation. Keep its bounds until every retained
  // cell has been checked, so a second edit cannot forget the first one's rays.
  const changes=compatible?[...old!.pendingChanges,...reuse!.changes]:[]
  let uncheckedCells=compatible?old!.cells:0
  if(compatible){counters.reusedCells=old!.cells;counters.retainedStates=old!.readyStates;counters.links=used}
  const positions = field.positionData.slice()
  const neighbourhoods = new Map<string, typeof field.probes>()
  const radiusSquared = (field.spacing * 1.75) ** 2, rayOrigin = new Vector3(), rayDirection = new Vector3()
  let decoded: Float32Array[] | null = null
  const sample = (_floor: number, x: number, y: number, z: number, voxel: number, result: Float64Array, visibilityOnly = false) => {
    counters.samples++
    // Ownership has moved from the discarded old cache. Recheck only segments
    // that could cross edited geometry; copied blocked states must be checked
    // too, because removal can turn them into visible support.
    if(checked&&!checked[voxel]){
      checked[voxel]=1
      if(offsets[voxel]!==0xffffffff){
        uncheckedCells--
        const radius=field.spacing*1.75+.002
        for(const box of changes){
          if(x<box.min[0]-radius||x>box.max[0]+radius||y<box.min[1]-radius||y>box.max[1]+radius||z<box.min[2]-radius||z>box.max[2]+radius)continue
          if(localFloorCells)localFloorCells[voxel]=0
          for(let i=offsets[voxel],end=i+counts[voxel];i<end;i++)if(states[i]){
            const p=indices[i]*4
            if(crossesEdit(positions[p],positions[p+1],positions[p+2],x,y,z,box)){states[i]=0;counters.invalidatedStates++;counters.retainedStates--}
          }
        }
      }
    }
    if (offsets[voxel] === 0xffffffff) {
      counters.newCells++
      offsets[voxel] = used
      const bx = Math.floor(x / field.spacing), bz = Math.floor(z / field.spacing)
      const key = `${bx}:${bz}`
      let candidates = neighbourhoods.get(key)
      if (!candidates) {
        candidates = []
        for (let iz = bz - 2; iz <= bz + 2; iz++) for (let ix = bx - 2; ix <= bx + 2; ix++) {
          candidates.push(...(bins.get(`${ix}:${iz}`) ?? []))
        }
        neighbourhoods.set(key, candidates)
      }
      for (const probe of candidates) {
        counters.candidateChecks++
        rayOrigin.copy(probe.position); rayDirection.set(x - rayOrigin.x, y - rayOrigin.y, z - rayOrigin.z)
        const distanceSquared = rayDirection.lengthSq()
        if (distanceSquared >= (probe.kind==='contact'?INDIRECT_CONTACT_RADIUS**2:radiusSquared)) continue
        if (used === indices.length) {
          const nextIndices = new Uint16Array(indices.length * 2), nextWeights = new Float32Array(weights.length * 2)
          const nextStates = new Uint8Array(states.length * 2)
          nextIndices.set(indices); nextWeights.set(weights); nextStates.set(states)
          indices = nextIndices; weights = nextWeights; states = nextStates
          counters.growthBytes+=indices.byteLength+weights.byteLength+states.byteLength
        }
        indices[used] = probe.index; weights[used++] = probe.kind==='contact'?indirectContactKernel(distanceSquared):(1 - distanceSquared / radiusSquared) ** 2; counts[voxel]++;counters.links++
      }
    }
    result.fill(0)
    if(localFloorCells&&!localFloorCells[voxel])localFloorCells[voxel]=indirectLocalFloorReceiver(field,visibility,_floor,x,y,z)?2:1
    const local=localFloorCells?.[voxel]===2
    let total = 0, support=0
    const start = offsets[voxel], end = start + counts[voxel]
    for (let i = start; i < end; i++) {
      const index = indices[i]
      // Startup previews omit uncaptured samples, but measured black samples remain valid.
      if (!visibilityOnly && field.positionData[index * 4 + 3] < .5) continue
      // Defer geometry rays until this probe has data. Each ray is still evaluated only once.
      if (states[i] === 0) {
        rayOrigin.fromArray(positions, index * 4); rayDirection.set(x - rayOrigin.x, y - rayOrigin.y, z - rayOrigin.z)
        const distance = rayDirection.length(), max = Math.max(0, distance - .001)
        const near=contacts.has(index)?.0001:.025
        if(max>near)counters.visibilityTests++
        states[i] = max > near && visibility.occluded(rayOrigin, rayDirection.multiplyScalar(1 / distance), max,near) ? 1 : 2
        if(states[i]===1)counters.blockedLinks++;else counters.visibleLinks++
      }
      if (states[i] === 1 || visibilityOnly) continue
      const p=index*4
      const d2=local||contacts.has(index)?(positions[p]-x)**2+(positions[p+1]-y)**2+(positions[p+2]-z)**2:0
      const weight = weights[i]*(contacts.has(index)?indirectContactWeight(d2):local?indirectLocalWeight(d2):1); total += weight;support+=weights[i]
      counters.blendedLinks++
      for (let colour = 0; colour < 3; colour++) for (let coefficient = 0; coefficient < field.coefficientCount; coefficient++) {
        result[colour * field.coefficientCount + coefficient] += (decoded ? decoded[colour][index * field.coefficientCount + coefficient]
          : DataUtils.fromHalfFloat(field.coefficients[colour][index * field.coefficientCount + coefficient])) * weight
      }
    }
    if (total > 0) for (let i = 0; i < field.coefficientCount * 3; i++) result[i] /= total
    return support
  }
  const warmResult = new Float64Array(field.coefficientCount * 3)
  return Object.assign(sample, { warm(floor: number, x: number, y: number, z: number, voxel: number) {
    sample(floor, x, y, z, voxel, warmResult, true)
  }, reuseData():IndirectInterpolationReuseData{return{layout,mask:mask.slice(),offsets,counts,indices,weights,states,localFloorCells,used,cells:counters.newCells+counters.reusedCells,readyStates:counters.retainedStates+counters.visibleLinks+counters.blockedLinks,pendingChanges:uncheckedCells>0?changes:[]}},statistics(){return{...counters,reuseAccepted:compatible,cellCapacity:voxels,linkCapacity:indices.length,localFloorCells:localFloorCells?.filter(v=>v===2).length??0,capacityBytes:offsets.byteLength+counts.byteLength+indices.byteLength+weights.byteLength+states.byteLength+(localFloorCells?.byteLength??0)+(checked?.byteLength??0)+(decoded?.reduce((sum,a)=>sum+a.byteLength,0)??0),averageLinksPerPreparedCell:counters.links/Math.max(1,counters.newCells+counters.reusedCells),coefficientProducts:counters.blendedLinks*field.coefficientCount*3}}, graph(): IndirectInterpolationGraph {
    const starts = new Uint32Array(voxels), lengths = new Uint16Array(voxels)
    const visibleIndices: number[] = [], visibleWeights: number[] = [],visibleSupports:number[]|undefined=localFloorCells?[]:undefined,overrideIndices:number[]=[],overrideWeights:number[]=[]
    for (let voxel = 0; voxel < voxels; voxel++) {
      starts[voxel] = visibleIndices.length
      if (offsets[voxel] === 0xffffffff) continue // Masked floor cells have no links.
      const end = offsets[voxel] + counts[voxel]
      const local=localFloorCells?.[voxel]===2
      const needPosition=local||contacts.size>0,n=floorLookup?field.floorLayer.n:field.volume.n,row=Math.floor(voxel/n),floor=floorLookup?Math.floor(row/n):Math.floor(row/(n*INDIRECT_VOLUME_HEIGHT)),ix=voxel%n,iz=floorLookup?row%n:Math.floor(row/INDIRECT_VOLUME_HEIGHT)%n,iy=row%INDIRECT_VOLUME_HEIGHT
      const x=needPosition?field.bounds.minX+ix/(n-1)*field.bounds.size:0,z=needPosition?field.bounds.minZ+iz/(n-1)*field.bounds.size:0
      let y=needPosition?field.floors[floor].elevation+.016:0
      if(needPosition&&!floorLookup){const range=field.ranges[floor],m=((floor*INDIRECT_MASK_SIZE+Math.min(511,Math.floor(iz/(n-1)*512)))*512+Math.min(511,Math.floor(ix/(n-1)*512)))*4,ceiling=range.bottom+(mask[m+1]*256+mask[m+2])/65535*(range.top-range.bottom);y=Math.max(field.floors[floor].elevation+.06,range.bottom+iy/11*(range.top-range.bottom));if(mask[m])y=Math.max(field.floors[floor].elevation+.06,Math.min(y,ceiling-.06))}
      for (let i = offsets[voxel]; i < end; i++) {
        if (!states[i]) throw new Error('GI interpolation visibility is not prepared')
        if (states[i] !== 2) continue
        const contact=contacts.has(indices[i]),p=indices[i]*4,d2=local||contact?(positions[p]-x)**2+(positions[p+1]-y)**2+(positions[p+2]-z)**2:0
        if(contact&&!visibleSupports){overrideIndices.push(visibleIndices.length);overrideWeights.push(weights[i])}
        visibleIndices.push(indices[i]); visibleWeights.push(weights[i]*(contact?indirectContactWeight(d2):local?indirectLocalWeight(d2):1));visibleSupports?.push(weights[i]); lengths[voxel]++
      }
    }
    return { offsets: starts, counts: lengths, indices: new Uint16Array(visibleIndices), weights: new Float32Array(visibleWeights),...(visibleSupports?{supports:new Float32Array(visibleSupports)}:{}),...(overrideIndices.length?{supportOverrides:{indices:new Uint32Array(overrideIndices),weights:new Float32Array(overrideWeights)}}:{}) }
  }, refreshCoefficients() {
    decoded ??= field.coefficients.map(data => new Float32Array(data.length))
    field.coefficients.forEach((data, colour) => { for (let i = 0; i < data.length; i++) decoded![colour][i] = DataUtils.fromHalfFloat(data[i]) })
    counters.decodedValues+=field.coefficients.reduce((sum,a)=>sum+a.length,0)
  } })
}

/** Exact segments are affordable during the bake and avoid angular moment-map wedges. */
export function sampleIndirectCoefficients(field: IndirectField, _floor: number, x: number, y: number, z: number,
  result: Float64Array, visibility: IndirectVisibility,localFloor=false) {
  result.fill(0)
  const radiusSquared = (field.spacing * 1.75) ** 2
  let total = 0,support=0
  for (const probe of field.probes) {
    // Storey labels are not occluders. Exact visibility below blocks solid
    // slabs while permitting neighbouring probes through an open stairwell.
    const index = probe.index, offset = index * 4
    if (field.positionData[offset + 3] < .5) continue
    origin.fromArray(field.positionData, offset)
    direction.set(x - origin.x, y - origin.y, z - origin.z)
    const distanceSquared = direction.lengthSq()
    const contact=probe.kind==='contact'
    if (distanceSquared >= (contact?INDIRECT_CONTACT_RADIUS**2:radiusSquared)) continue
    // These are volume samples, not surface receivers. A centimetre-scale
    // endpoint bias can see through a wall into a voxel inside the solid.
    const distance = Math.sqrt(distanceSquared), max = Math.max(0, distance - .001)
    const near=contact?.0001:.025
    if (max > near && visibility.occluded(origin, direction.multiplyScalar(1 / distance), max,near)) continue
    // A compact, smooth kernel uses the actual relocated position, avoiding
    // grid-cell diagonals and abrupt changes when a nominal corner disappears.
    const baseWeight = contact?indirectContactKernel(distanceSquared):(1 - distanceSquared / radiusSquared) ** 2,weight=baseWeight*(contact?indirectContactWeight(distanceSquared):localFloor?indirectLocalWeight(distanceSquared):1)
    support+=baseWeight
    total += weight
    for (let colour = 0; colour < 3; colour++) for (let coefficient = 0; coefficient < field.coefficientCount; coefficient++) {
      result[colour * field.coefficientCount + coefficient] += DataUtils.fromHalfFloat(field.coefficients[colour][index * field.coefficientCount + coefficient]) * weight
    }
  }
  if (total > 0) for (let i = 0; i < field.coefficientCount * 3; i++) result[i] /= total
  return support
}

/** Cache actual headroom in the existing mask; no extra display texture fetch. */
export function writeIndirectCeilingRow(field: IndirectField, row: number, structure: IndirectVisibility) {
  const floor = Math.floor(row / INDIRECT_MASK_SIZE), z = row % INDIRECT_MASK_SIZE
  const range = field.ranges[floor], data = field.mask.image.data as Uint8Array
  direction.set(0, 1, 0)
  for (let x = 0; x < INDIRECT_MASK_SIZE; x++) {
    const offset = (row * INDIRECT_MASK_SIZE + x) * 4
    if (!data[offset]) continue
    origin.set(field.bounds.minX + (x + .5) / INDIRECT_MASK_SIZE * field.bounds.size,
      field.floors[floor].elevation + .08, field.bounds.minZ + (z + .5) / INDIRECT_MASK_SIZE * field.bounds.size)
    const max = Math.max(0, range.top - origin.y), ceiling = origin.y + structure.distance(origin, direction, max)
    const packed = Math.round(Math.max(0, Math.min(1, (ceiling - range.bottom) / (range.top - range.bottom))) * 65535)
    data[offset + 1] = packed >> 8; data[offset + 2] = packed & 255
  }
}

/** One row is a small, bounded unit of background CPU work. */
export function writeIndirectVolumeRow(field: IndirectField, row: number, result: Float64Array, visibility: IndirectVisibility,
  lookup?: ReturnType<typeof createIndirectVolumeLookup>, visibilityOnly = false) {
  const volume = field.volume, floor = Math.floor(row / (volume.n * INDIRECT_VOLUME_HEIGHT))
  const iz = Math.floor(row / INDIRECT_VOLUME_HEIGHT) % volume.n, iy = row % INDIRECT_VOLUME_HEIGHT
  const range = field.ranges[floor]
  const y = Math.max(field.floors[floor].elevation + .06,
    range.bottom + iy / (INDIRECT_VOLUME_HEIGHT - 1) * (range.top - range.bottom))
  const z = field.bounds.minZ + iz / (volume.n - 1) * field.bounds.size
  for (let ix = 0; ix < volume.n; ix++) {
    const x = field.bounds.minX + ix / (volume.n - 1) * field.bounds.size
    const mx = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(ix / (volume.n - 1) * INDIRECT_MASK_SIZE))
    const mz = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(iz / (volume.n - 1) * INDIRECT_MASK_SIZE))
    const mask = field.mask.image.data as Uint8Array, m = ((floor * INDIRECT_MASK_SIZE + mz) * INDIRECT_MASK_SIZE + mx) * 4
    const ceiling = range.bottom + (mask[m + 1] * 256 + mask[m + 2]) / 65535 * (range.top - range.bottom)
    // Extend interior radiance into the border above the ceiling. Occupancy
    // still excludes exterior receivers; filtering never mixes with attic black.
    const sampleY = mask[m] ? Math.max(field.floors[floor].elevation + .06, Math.min(y, ceiling - .06)) : y
    if (visibilityOnly) { lookup!.warm(floor, x, sampleY, z, row * volume.n + ix); continue }
    const supported = (lookup ? lookup(floor, x, sampleY, z, row * volume.n + ix, result)
      : sampleIndirectCoefficients(field, floor, x, sampleY, z, result, visibility)) > 0
    const rows = [floor * INDIRECT_VOLUME_STRIDE + iy + 1]
    if (iy === 0) rows.push(floor * INDIRECT_VOLUME_STRIDE)
    if (iy === INDIRECT_VOLUME_HEIGHT - 1) rows.push(floor * INDIRECT_VOLUME_STRIDE + INDIRECT_VOLUME_STRIDE - 1)
    for (const targetRow of rows) {
      for (let coefficient = 0; coefficient < field.coefficientCount; coefficient++) {
        const offset = ((iz * volume.height * field.coefficientCount + coefficient * volume.height + targetRow) * volume.n + ix) * 4
        for (let colour = 0; colour < 3; colour++) volume.data[offset + colour] = DataUtils.toHalfFloat(result[colour * field.coefficientCount + coefficient])
        volume.data[offset + 3] = DataUtils.toHalfFloat(supported ? 1 : 0)
      }
    }
  }
}
