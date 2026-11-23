import { DataUtils, Vector3 } from 'three'
import { createIndirectField, serializeIndirectField, type IndirectFloor } from './indirectLighting.ts'
import { createIndirectVolumeLookup, writeIndirectVolumeRow } from './indirectVolume.ts'
import { createSixRaySolver, SIX_RAY_VOLUME_RESOLUTION, type SixRayInspection, type SixRayLighting, type SixRayOpening, type SixRayOptions } from './sixRayLighting.ts'
import type { ReferenceSceneData } from './diffuseSceneMaterials.ts'
import type { IndirectSHOrder } from './indirectSH.ts'

export type SixRayRequest =
  | { kind: 'prepare'; data: ReferenceSceneData; openings: SixRayOpening[]; floors: IndirectFloor[]; order: IndirectSHOrder }
  | { kind: 'solve'; id: number; lighting: SixRayLighting; options: SixRayOptions }
  | { kind: 'inspect'; id: number; point: number[]; normal: number[] }

export type SixRayReply =
  | { kind: 'ready'; field: ReturnType<typeof serializeIndirectField>; bvhMs: number; layoutMs: number }
  | { kind: 'result'; id: number; coefficients: Float32Array; volume: Uint16Array; volumeMs: number;
      stats: ReturnType<ReturnType<typeof createSixRaySolver>['solve']>['stats'] }
  | { kind: 'inspection'; id: number; report?: SixRayInspection }
  | { kind: 'error'; detail: string }

let solver: ReturnType<typeof createSixRaySolver>
let field: ReturnType<typeof createIndirectField>
let lookup: ReturnType<typeof createIndirectVolumeLookup>
let last: Extract<SixRayRequest, { kind: 'solve' }> | undefined

function reply(value: SixRayReply, transfer: Transferable[] = []) {
  self.postMessage(value, { transfer })
}

self.onmessage = ({ data: request }: MessageEvent<SixRayRequest>) => {
  try {
    if (request.kind === 'prepare') {
      const start = performance.now()
      solver = createSixRaySolver(request.data, request.openings)
      const bvhMs = performance.now() - start
      field = createIndirectField(request.floors, 0, request.order, 'legacy', false, SIX_RAY_VOLUME_RESOLUTION)
      lookup = createIndirectVolumeLookup(field, solver.visibility, undefined, undefined, false, 4)
      reply({ kind: 'ready', field: serializeIndirectField(field), bvhMs, layoutMs: performance.now() - start - bvhMs })
    } else if (request.kind === 'solve') {
      const { coefficients, stats } = solver.solve(field.probes, request.options, request.lighting)
      const start = performance.now(), count = field.coefficientCount
      field.probes.forEach((probe, i) => {
        for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) {
          field.coefficients[c][probe.index * count + k] = DataUtils.toHalfFloat(coefficients[i * 12 + k * 3 + c])
        }
      })
      lookup.refreshCoefficients()
      const scratch = new Float64Array(count * 3)
      for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, scratch, solver.visibility, lookup)
      last = request
      const volume = field.volume.data.slice()
      reply({ kind: 'result', id: request.id, coefficients, volume, volumeMs: performance.now() - start, stats },
        [coefficients.buffer, volume.buffer])
    } else {
      const point = new Vector3().fromArray(request.point)
      const probe = field?.probes.reduce<(typeof field.probes)[number] | undefined>((nearest, other) =>
        !nearest || other.position.distanceToSquared(point) < nearest.position.distanceToSquared(point) ? other : nearest, undefined)
      const normal = new Vector3().fromArray(request.normal).normalize()
      reply({ kind: 'inspection', id: request.id, report: probe && last && solver.inspect(probe, normal, last.options, last.lighting) })
    }
  } catch (error) {
    reply({ kind: 'error', detail: error instanceof Error ? error.message : String(error) })
  }
}
