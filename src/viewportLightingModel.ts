/** The editor starts in Design on each visit. A preview is a session action. */
export type ViewportLightingModel = 'design' | 'existing' | 'modelling'

export function normalizeViewportLightingModel(value: unknown): ViewportLightingModel {
  return value === 'existing' || value === 'modelling' ? value : 'design'
}

export function initialViewportLightingModel(readOnly: boolean, basicDiagnostic: boolean, developer: URLSearchParams | undefined): ViewportLightingModel {
  if (readOnly || basicDiagnostic) return 'existing'
  if (developer?.has('lightingModel')) return normalizeViewportLightingModel(developer.get('lightingModel'))
  return developer?.has('giBackend') ? 'existing' : 'design'
}
