export type RecoveryShadowMode = 'single' | 'cascaded' | 'off'

/** Recovery baseline is the existing single sun map. Expensive cascades are
 * available only to an explicit development A/B measurement. */
export function recoveryShadowMode(search: string, development: boolean): RecoveryShadowMode {
  if (!development) return 'single'
  const mode = new URLSearchParams(search).get('rendererShadows')
  return mode === 'cascaded' || mode === 'off' ? mode : 'single'
}

export const rendererShadowMode = recoveryShadowMode(
  typeof location === 'undefined' ? '' : location.search,
  import.meta.env?.DEV === true,
)

export function recoveryShadowSize(search: string, development: boolean) {
  return development && new URLSearchParams(search).get('rendererShadowSize') === '1024' ? 1024 : 2048
}
const search = typeof location === 'undefined' ? '' : location.search
export const rendererShadowSize = recoveryShadowSize(search, import.meta.env?.DEV === true)
export const rendererAuditEnabled = import.meta.env?.DEV === true && new URLSearchParams(search).get('rendererAudit') === '1'
export const rendererContextRecoveryEnabled = rendererAuditEnabled && new URLSearchParams(search).get('rendererRecoverContext') === '1'
