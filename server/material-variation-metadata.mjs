// Explicitly persist these fields on both create and edit. Older clients that
// omit them must not clear an existing material's variation settings.
const variationFields = [
  'enabled', 'mode', 'brickStrength', 'broadStrength', 'broadScaleMeters', 'seed',
  'bricksAcross', 'brickRows', 'rowOffset', 'offsetU', 'offsetV',
]

export function getMaterialVariationMetadata(fields, previous = {}) {
  return Object.fromEntries(variationFields.map((name) => {
    const key = `variation_${name}`
    return [key, fields[key] ?? previous[key] ?? '']
  }))
}
