export const HOUSE_DAYLIGHT_KEY = 'houseLightingLab.prototypeDaylight'

export function housePrototypeDaylight(parameters: URLSearchParams, saved: string | null) {
  const explicit = parameters.get('prototypeDaylight')
  if (explicit === '0' || explicit === '1') return explicit === '1'
  return saved !== '0'
}
