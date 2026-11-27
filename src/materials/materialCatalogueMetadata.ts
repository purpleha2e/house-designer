import type { SurfaceCategory, SurfaceMaterialProduct } from '../types.ts'

export const surfaceCategoryLabels: Record<SurfaceCategory, string> = {
  ceiling: 'Ceiling',
  flooring: 'Flooring',
  paint: 'Paint',
  tile: 'Tile',
  'wall-covering': 'Wall covering',
  worktop: 'Worktop',
}

export function parseSurfaceCategory(value?: string): SurfaceCategory | undefined {
  const key = normalizeMaterialLabel(value).toLowerCase().replaceAll(' ', '-')
  if (key === 'tiles') return 'tile'
  if (key === 'wallpaper') return 'wall-covering'
  return Object.hasOwn(surfaceCategoryLabels, key) ? key as SurfaceCategory : undefined
}

export function normalizeMaterialLabel(value?: string) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function materialCategoryLabel(material: SurfaceMaterialProduct) {
  return normalizeMaterialLabel(material.catalogueCategory) || surfaceCategoryLabels[material.category]
}

export function materialLabelChoices(values: Array<string | undefined>) {
  const labels = new Map<string, string>()
  for (const value of values) {
    const label = normalizeMaterialLabel(value)
    const key = label.toLowerCase()
    if (label && !labels.has(key)) labels.set(key, label)
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
