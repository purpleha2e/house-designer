import { Material } from 'three'

/** Cache only an exact string transformation. Callers still read their upstream
 * key and live feature flags on every request. One entry per hook bounds memory
 * and preserves dynamic keys, inherited hooks and byte-for-byte program keys. */
export function cacheShaderKeyTransform(transform: (source: string, features: string) => string) {
  let source: string | undefined, features: string | undefined, result = ''
  return (nextSource: string, nextFeatures: string) => {
    if (nextSource === source && nextFeatures === features) return result
    const next = transform(nextSource, nextFeatures)
    source = nextSource; features = nextFeatures; result = next
    return next
  }
}

/** Three's default key reads this.onBeforeCompile at call time. Capture it
 * before wrapping, otherwise whichever lighting scan ran last becomes the key. */
export function captureMaterialShaderKey(material: Material) {
  if (material.customProgramCacheKey === Material.prototype.customProgramCacheKey) {
    const key = material.onBeforeCompile.toString()
    return () => key
  }
  return material.customProgramCacheKey.bind(material)
}
// These independent lighting patches may attach in separate cooperative scans.
// Their order is not a shader feature. The latest descriptor of each patch wins.
const lightingMarkers = /:opening-preview-v\d+|:house-designer-room-light-v\d+(?:-(?:single|cascaded|off)(?:-\d+)?)?(?:-capacity\d+)?|-house-designer-specular-ibl-v\d+|:house-designer-indirect-grid-l[12]-v\d+-(?:capture|display|exterior-tint)(?:-fast)?(?:-diagnostics)?(?:-contacts)?(?:-sunbounce)?(?:-local-sun)?(?:-exterior-sky(?:-eaves\d+)?)?/g
export function composedMaterialShaderKey() {
  return cacheShaderKeyTransform((source, features) => {
    const descriptors = new Map<string, string>()
    const base = (source + features).replace(lightingMarkers, value => {
      const kind = value.includes('opening-preview') ? '0-opening' : value.includes('room-light') ? '1-room'
        : value.includes('specular-ibl') ? '2-ibl' : '3-indirect'
      descriptors.set(kind, value)
      return ''
    })
    return base.replace(/:surface-finish:standard(?=:|$)/g, '') + [...descriptors].sort(([a], [b]) => a.localeCompare(b)).map(([,value]) => value).join('')
  })
}
