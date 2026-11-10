const selectionFields = new Set(['selectedModelId', 'selectedWallId', 'selectedRoofId', 'selectedSurface'])

/** Selection and fresh event closures need no authored-scene publication delay.
 * Every other input, including project, floor visibility and worker status, must
 * retain its identity before it is safe to bypass that delay. */
export function isSelectionOnlyPublication(previous: object, next: object) {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].every(key => {
    const before = Reflect.get(previous, key), after = Reflect.get(next, key)
    return selectionFields.has(key) || before === after ||
      (typeof before === 'function' && typeof after === 'function')
  })
}
