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
