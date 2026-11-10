export const DEFAULT_DAYLIGHT_AMBIENT_TERM = .30
export const DEFAULT_NIGHT_AMBIENT_TERM = .03

/** Analytic exterior sky already supplies the daylight hemisphere. Keep the
 * authored fill, and use the legacy extra fill only before that sky is ready. */
export function viewportAmbientFillIntensity(ambientTerm: number, daylight: boolean, exteriorSkyReady: boolean) {
  return ambientTerm + (daylight && !exteriorSkyReady ? .45 : 0)
}

/** Keep legacy authored values up to 4; the daylight menu offers 0–3. */
export function normalizeSkyStrength(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 1
}

type AmbientSettings = {
  ambientTerm: number
  nightAmbientTerm?: number
  nightFill?: boolean
  daylight: boolean
  skyMode?:'clear'|'overcast'
  skyStrength?: number
}

export type AmbientLightingPreferences = {
  daylight: boolean
  ambientTerm: number
  nightAmbientTerm: number
  skyMode?:'clear'|'overcast'
  skyStrength?: number
}

/** Older models used the daylight term for their optional night fill. Preserve
 * an enabled saved fill; otherwise introduce the dim night default. */
export function nightAmbientTerm(settings?: Pick<AmbientSettings, 'ambientTerm' | 'nightAmbientTerm' | 'nightFill'>) {
  return settings?.nightAmbientTerm ?? (settings?.nightFill ? settings.ambientTerm : DEFAULT_NIGHT_AMBIENT_TERM)
}

export function restoreAmbientSettings(settings?: AmbientSettings) {
  return {
    daylight: settings?.daylight ?? true,
    ambientTerm: settings?.ambientTerm ?? DEFAULT_DAYLIGHT_AMBIENT_TERM,
    nightAmbientTerm: nightAmbientTerm(settings),
  }
}

export function activeAmbientTerm(settings: AmbientSettings) {
  return settings.daylight ? settings.ambientTerm : nightAmbientTerm(settings)
}

export function ambientLightingPreferences(settings?: AmbientSettings): AmbientLightingPreferences {
  const { daylight, ambientTerm, nightAmbientTerm } = restoreAmbientSettings(settings)
  return { daylight, ambientTerm, nightAmbientTerm,...(settings?.skyMode?{skyMode:settings.skyMode}:{}),
    ...(settings?.skyStrength !== undefined ? { skyStrength: normalizeSkyStrength(settings.skyStrength) } : {}) }
}

export function normalizeAmbientLightingPreferences(value: unknown): AmbientLightingPreferences | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as AmbientLightingPreferences
  if (typeof candidate.daylight !== 'boolean' ||
    ![candidate.ambientTerm, candidate.nightAmbientTerm].every(term => typeof term === 'number' && Number.isFinite(term))) return undefined
  const clamp = (term: number) => Math.max(0, Math.min(.85, term))
  return { daylight: candidate.daylight, ambientTerm: clamp(candidate.ambientTerm), nightAmbientTerm: clamp(candidate.nightAmbientTerm),
    ...(['clear','overcast'].includes(candidate.skyMode??'')?{skyMode:candidate.skyMode}:{}),
    ...(candidate.skyStrength !== undefined ? { skyStrength: normalizeSkyStrength(candidate.skyStrength) } : {}) }
}
