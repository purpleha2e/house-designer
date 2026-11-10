import type { ExteriorEaveField } from './exteriorEaveOcclusion.ts'
import type { ExteriorSkyField } from './exteriorSkyOcclusion.ts'

/** Share one sampler: physical facade materials can already use all 16 slots.
 * Sky slices retain their 3D layout; roof texels occupy the trailing slices.
 * Keep every dimension within WebGL2's guaranteed 256-texel 3D texture limit. */
export function packExteriorSkyTexture(field: ExteriorSkyField, eaves: ExteriorEaveField | null) {
  const [nx, ny, nz] = field.dimensions, roofCount = (eaves?.data.length ?? 0) / 4
  const roofSide = Math.ceil(Math.sqrt(roofCount / (256 - 2 * nz)))
  const width = Math.max(nx, roofSide), height = Math.max(ny, roofSide)
  const slice = width * height, depth = nz * 2 + Math.ceil(roofCount / slice)
  const data = new Uint8Array(slice * depth * 4)
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const start = (z * ny + y) * nx * 4, target = (z * height + y) * width * 4
    data.set(field.positive.subarray(start, start + nx * 4), target)
    data.set(field.negative.subarray(start, start + nx * 4), target + nz * slice * 4)
  }
  if (eaves) data.set(eaves.data, nz * 2 * slice * 4)
  return { data, width, height, depth }
}
