import assert from 'node:assert/strict'
import test from 'node:test'
import { createJoinedRoofAssemblyGeometries, type RoofAssemblyInput } from '../src/roofAssembly.ts'
import { createRoofAssemblyJob, restoreRoofAssemblyJob, runRoofAssemblyJob, restoreRoofAssemblyResult } from '../src/roofAssemblyJob.ts'
import { roofJunctionInput, resolveRoofJunctions } from '../src/roofJunctions.ts'

test('worker roof output preserves joined geometry, UVs and affine abutments', () => {
  const resolved = resolveRoofJunctions([roofJunctionInput({ id: 'roof', type: 'up-and-over', width: 4, depth: 6,
    pitchDegrees: 30, position: { x: 0, y: 0 }, rotation: 0, overhangSide: .3 }, 'floor', 3)])[0]
  resolved.abutments = [{ top: 4, plane: ([x,y,z]) => x + 2*y - 3*z + 4, coveragePlane: ([x]) => x - 2, spanPlanes: [([,y]) => y + 5] }]
  const inputs: RoofAssemblyInput[] = [{ resolved, dormerOpenings: [[{ x: -.5, y: -.5 }, { x: .5, y: -.5 }, { x: .5, y: .5 }, { x: -.5, y: .5 }]] }]
  const job = structuredClone(createRoofAssemblyJob(inputs)), restored = restoreRoofAssemblyJob(job)
  assert.equal(restored[0].resolved.abutments![0].plane([2,3,4]), 0)
  assert.equal(restored[0].resolved.abutments![0].coveragePlane!([3,0,0]), 1)
  assert.equal(restored[0].resolved.abutments![0].spanPlanes![0]([0,3,0]), 8)
  const direct = createJoinedRoofAssemblyGeometries(inputs), background = restoreRoofAssemblyResult(structuredClone(runRoofAssemblyJob(job)))
  for (const [id,parts] of direct) for (const [part,geometry] of Object.entries(parts)) {
    const other = background.get(id)![part as keyof typeof parts]
    if (!geometry) { assert.equal(other, geometry); continue }
    for (const attribute of ['position', 'normal', 'uv']) assert.deepEqual(other!.getAttribute(attribute).array, geometry.getAttribute(attribute).array)
    geometry.dispose(); other!.dispose()
  }
})
