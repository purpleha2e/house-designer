export const DIFFUSE_PROBE_RESOLUTIONS = [4, 8, 16] as const
export type DiffuseProbeResolution = typeof DIFFUSE_PROBE_RESOLUTIONS[number]
export function normalizeDiffuseProbeResolution(value: unknown): DiffuseProbeResolution {
  return value === 4 || value === 8 ? value : 16
}
