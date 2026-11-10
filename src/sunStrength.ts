/** Relative multiplier of the existing elevation-dependent sunlight source. */
export function normalizeSunStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 1
}
