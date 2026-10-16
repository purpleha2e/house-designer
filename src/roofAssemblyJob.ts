import { BufferAttribute, BufferGeometry, type TypedArray } from 'three'
import { createJoinedRoofAssemblyGeometries, type RoofAssemblyInput } from './roofAssembly.ts'
import type { RoofGeometries } from './roofSolidGeometry.ts'
import type { ClipPlane } from './wallEngine/wallRoofClip.ts'

type Plane = [number, number, number, number]
type Abutment = NonNullable<RoofAssemblyInput['resolved']['abutments']>[number]
export type RoofAssemblyJob = (Omit<RoofAssemblyInput, 'resolved'> & {
  resolved: Omit<RoofAssemblyInput['resolved'], 'abutments'> & {
    abutments?: (Omit<Abutment, 'plane' | 'coveragePlane' | 'spanPlanes'> & {
      plane: Plane; coveragePlane?: Plane; spanPlanes?: Plane[]
    })[]
  }
})[]
type GeometryData = { attributes: [string, TypedArray, number, boolean][]; index?: Uint16Array | Uint32Array }
export type RoofAssemblyResult = [string, [string, GeometryData | null][]][]
const encodePlane = (p: ClipPlane): Plane => {
  const d = p([0, 0, 0])
  return [p([1, 0, 0]) - d, p([0, 1, 0]) - d, p([0, 0, 1]) - d, d]
}
const decodePlane = ([a,b,c,d]: Plane): ClipPlane => ([x,y,z]) => a*x+b*y+c*z+d
export function createRoofAssemblyJob(inputs: RoofAssemblyInput[]): RoofAssemblyJob {
  return inputs.map(input => ({ ...input, resolved: { ...input.resolved,
    abutments: input.resolved.abutments?.map(abutment => ({ ...abutment,
      plane: encodePlane(abutment.plane), coveragePlane: abutment.coveragePlane && encodePlane(abutment.coveragePlane),
      spanPlanes: abutment.spanPlanes?.map(encodePlane),
    })),
  } }))
}
export function restoreRoofAssemblyJob(job: RoofAssemblyJob): RoofAssemblyInput[] {
  return job.map(input => ({ ...input, resolved: { ...input.resolved,
    abutments: input.resolved.abutments?.map(abutment => ({ ...abutment,
      plane: decodePlane(abutment.plane), coveragePlane: abutment.coveragePlane && decodePlane(abutment.coveragePlane),
      spanPlanes: abutment.spanPlanes?.map(decodePlane),
    })),
  } }))
}
export function runRoofAssemblyJob(job: RoofAssemblyJob): RoofAssemblyResult {
  const inputs = restoreRoofAssemblyJob(job)
  return [...createJoinedRoofAssemblyGeometries(inputs)].map(([id, parts]) => [id,
    Object.entries(parts).map(([name, geometry]) => [name, geometry ? {
      attributes: Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array, attribute.itemSize, attribute.normalized]),
      ...(geometry.index ? { index: geometry.index.array as Uint16Array | Uint32Array } : {}),
    } : null]),
  ])
}
export function restoreRoofAssemblyResult(result: RoofAssemblyResult) {
  return new Map(result.map(([id, parts]) => [id, Object.fromEntries(parts.map(([name, data]) => {
    if (!data) return [name, null]
    const geometry = new BufferGeometry()
    data.attributes.forEach(([name, array, size, normalized]) => geometry.setAttribute(name, new BufferAttribute(array, size, normalized)))
    if (data.index) geometry.setIndex(new BufferAttribute(data.index, 1))
    geometry.computeBoundingSphere()
    return [name, geometry]
  })) as RoofGeometries]))
}
