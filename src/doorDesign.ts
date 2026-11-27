import type { ModelDefinition } from './models/modelLibrary'
import type { MaterialTextureTransform } from './types'
import { kitchenHandleFinishes } from './kitchenUnitDesign.ts'

export const doorStyles = { vertical: 'Vertical planks', horizontal: 'Horizontal planks', raised: 'Raised panels' } as const
export type DoorStyle = keyof typeof doorStyles
export const doorFrameProfiles = { plain: 'Plain', curved: 'Simple curved', decorative: 'Decorative moulding' } as const
export type DoorFrameProfile = keyof typeof doorFrameProfiles
export const doorPanelDetails = { simple: 'Simple', detailed: 'Detailed' } as const
export type DoorPanelDetail = keyof typeof doorPanelDetails
export const DEFAULT_DOOR_GROOVE_COLOR = '#80613f'
export type DoorPanel = { left: number; bottom: number; width: number; height: number } & MaterialTextureTransform
export type DoorAngles = [number, number]
export type DoorDesign = {
  width: number
  height: number
  leafCount: 1 | 2
  style: DoorStyle
  handing: 'left' | 'right'
  swing: 'front' | 'back'
  thickness: number
  jambWidth: number
  frameProjection: number
  frameProfile?: DoorFrameProfile
  panels: DoorPanel[]
  panelDetail?: DoorPanelDetail
  grooveColor?: string
  leafTexture?: MaterialTextureTransform
  panelTexture?: MaterialTextureTransform
  oakMaterialId?: string
  frameMaterialId?: string | null
  handleFinish: keyof typeof kitchenHandleFinishes
  handleHeight?: number
}

export const doorDimensionFields = [
  { key: 'width', label: 'Leaf width', min: .610, max: .838 },
  { key: 'height', label: 'Leaf height', min: 1.65, max: 2.5 },
  { key: 'thickness', label: 'Door thickness', min: .03, max: .07 },
  { key: 'jambWidth', label: 'Jamb width', min: .018, max: .065 },
  { key: 'frameProjection', label: 'Frame projection per side', min: .01, max: .02 },
] as const

const panelSpacing = {
  vertical: { x: .005, y: .003 }, horizontal: { x: .005, y: .003 }, raised: { x: .12, y: .115 },
} as const
const minPanelSize = .025
export const doorTextureScale = { min: .1, max: 10 } as const

function panelPresetArea(style: DoorStyle) {
  const insetX = style === 'raised' ? .15 : .135
  const insetY = style === 'horizontal' ? .035 : .10
  return { left: insetX, bottom: insetY, width: 1 - 2 * insetX, height: 1 - 2 * insetY }
}

function fitPanelSpan(start: number, span: number, count: number, gap: number, minimum: number) {
  const size = Math.max(span, minimum * count)
  const origin = Math.min(.99 - size, Math.max(.01, start + (span - size) / 2))
  const spacing = count > 1 ? Math.min(gap, Math.max(0, (size - minimum * count) / (count - 1))) : 0
  return { origin, size, spacing, cell: (size - spacing * (count - 1)) / count }
}

function arrangeDoorPanels(style: DoorStyle, panels: DoorPanel[], area: DoorPanel) {
  if (!panels.length) return []
  const columns = style === 'vertical' ? panels.length : style === 'raised' ? Math.min(2, panels.length) : 1
  const rows = Math.ceil(panels.length / columns)
  const { x, y } = panelSpacing[style]
  const minWidth = (minPanelSize + 1e-8) / doorDimensionFields[0].min
  const across = fitPanelSpan(area.left, area.width, columns, x, minWidth)
  const up = fitPanelSpan(area.bottom, area.height, rows, y, (minPanelSize + 1e-8) / doorDimensionFields[1].min)
  return panels.map((panel, index) => {
    const row = Math.floor(index / columns)
    const rowCount = Math.min(columns, panels.length - row * columns)
    const rowSpan = rowCount === columns ? across : fitPanelSpan(across.origin, across.size, rowCount, x, minWidth)
    return { ...panel, left: rowSpan.origin + (index % columns) * (rowSpan.cell + rowSpan.spacing),
      bottom: up.origin + row * (up.cell + up.spacing), width: rowSpan.cell, height: up.cell }
  })
}

export function doorPresetPanels(style: DoorStyle): DoorPanel[] {
  const area = panelPresetArea(style)
  return arrangeDoorPanels(style, Array.from({ length: style === 'raised' ? 4 : 5 }, () => area), area)
}

/** Keep the extent of the old layout while filling it with evenly sized rows and columns. */
export function spaceDoorPanels(design: DoorDesign, panels: DoorPanel[]) {
  let area = panelPresetArea(design.style)
  if (design.panels.length) {
    const left = Math.min(...design.panels.map(panel => panel.left))
    const bottom = Math.min(...design.panels.map(panel => panel.bottom))
    const right = Math.max(...design.panels.map(panel => panel.left + panel.width))
    const top = Math.max(...design.panels.map(panel => panel.bottom + panel.height))
    if ([left, bottom, right, top].every(Number.isFinite) && left >= .01 && right <= .99 && bottom >= .01 && top <= .99) {
      area = { left, bottom, width: right - left, height: top - bottom }
    }
  }
  return arrangeDoorPanels(design.style, panels, area)
}

export function createDoorDesign(): DoorDesign {
  return { width: .762, height: 1.981, leafCount: 1, style: 'vertical', handing: 'left', swing: 'front',
    thickness: .045, jambWidth: .028, frameProjection: .015, frameProfile: 'plain',
    panels: doorPresetPanels('vertical'), handleFinish: 'brushed-silver', handleHeight: 1 }
}

export const DOOR_CASING_WIDTH = .036
export const DOOR_MAX_ANGLE = 110
export const DOOR_LEAF_FLOOR_GAP = .009
export const doorMaterialRegions = [{ id: 'hd_oak', label: 'Oak', sourceMaterialNames: ['hd_oak'] },
  { id: 'hd_frame', label: 'Frame', sourceMaterialNames: ['hd_frame'] },
  { id: 'hd_handle', label: 'Handle and hinges', sourceMaterialNames: ['hd_handle'] }]

export function getDoorMaterialIds(design: DoorDesign, overrides?: Record<string, string>) {
  const leaf = overrides?.hd_oak ?? design.oakMaterialId
  const frame = overrides?.hd_frame ?? (design.frameMaterialId === undefined ? leaf : design.frameMaterialId)
  return { ...(leaf && { hd_oak: leaf }), ...(frame && { hd_frame: frame }), ...overrides }
}

/** A shared setting replaces only its own axis of any previously authored panel mapping. */
export function getDoorPanelTextureValue(design: DoorDesign, key: keyof MaterialTextureTransform) {
  const fallback = key === 'textureScale' ? 1 : 0
  const shared = design.panelTexture?.[key]
  if (shared !== undefined) return shared
  const first = design.panels[0]?.[key] ?? fallback
  return design.panels.every(panel => (panel[key] ?? fallback) === first) ? first : undefined
}

function validDoorTexture(transform: MaterialTextureTransform | undefined) {
  if (transform === undefined) return true
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) return false
  const { textureScale, textureRotation } = transform
  return (textureScale === undefined || (Number.isFinite(textureScale) &&
    textureScale >= doorTextureScale.min && textureScale <= doorTextureScale.max)) &&
    (textureRotation === undefined || Number.isFinite(textureRotation))
}

export function getDoorOpeningSize(design: DoorDesign) {
  return { width: design.width * design.leafCount + 2 * design.jambWidth + .006 + (design.leafCount - 1) * .004,
    height: design.height + design.jambWidth + .012 }
}

export function getDoorHandleHeight(design: DoorDesign) {
  return design.handleHeight ?? (DOOR_LEAF_FLOOR_GAP + Math.min(1, design.height * .53))
}

export function getDoorHandleHeightBounds(design: DoorDesign) {
  return { min: .05, max: design.height - .05 }
}

export function normalizeDoorAngles(angles?: unknown): DoorAngles {
  return [0, 1].map(index => {
    const angle: unknown = Array.isArray(angles) ? angles[index] : undefined
    return typeof angle === 'number' && Number.isFinite(angle) ? Math.max(0, Math.min(DOOR_MAX_ANGLE, angle)) : 0
  }) as DoorAngles
}

export function getDoorHingeSide(design: DoorDesign, index: number): -1 | 1 {
  return design.leafCount === 2 ? index === 0 ? -1 : 1 : design.handing === 'left' ? -1 : 1
}

export function getDoorSwingSign(design: DoorDesign, index: number) {
  return getDoorHingeSide(design, index) * (design.swing === 'front' ? 1 : -1)
}

export function validateDoorDesign(value: unknown) {
  if (!value || typeof value !== 'object') return 'A door design is required.'
  const design = value as DoorDesign
  for (const { key, label, min, max } of doorDimensionFields) {
    if (!Number.isFinite(design[key]) || design[key] < min || design[key] > max) {
      return `${label} must be between ${Math.round(min * 1000)} and ${Math.round(max * 1000)} mm.`
    }
  }
  if ((design.leafCount !== 1 && design.leafCount !== 2) ||
    (design.handing !== 'left' && design.handing !== 'right') || (design.swing !== 'front' && design.swing !== 'back') ||
    !Object.hasOwn(doorStyles, design.style) || !Object.hasOwn(kitchenHandleFinishes, design.handleFinish)) return 'Choose valid door options.'
  if (design.oakMaterialId !== undefined && (typeof design.oakMaterialId !== 'string' || !design.oakMaterialId.trim())) return 'Choose a valid oak finish.'
  if (design.frameMaterialId != null && (typeof design.frameMaterialId !== 'string' || !design.frameMaterialId.trim())) return 'Choose a valid frame finish.'
  if (design.frameProfile !== undefined && !Object.hasOwn(doorFrameProfiles, design.frameProfile)) return 'Choose a valid frame profile.'
  if (design.panelDetail !== undefined && !Object.hasOwn(doorPanelDetails, design.panelDetail)) return 'Choose a valid panel detail.'
  if (design.handleHeight !== undefined) {
    const { min, max } = getDoorHandleHeightBounds(design)
    if (!Number.isFinite(design.handleHeight) || design.handleHeight < min || design.handleHeight > max) {
      return `Handle height must be between ${Math.round(min * 1000)} and ${Math.round(max * 1000)} mm.`
    }
  }
  if (design.grooveColor !== undefined && (typeof design.grooveColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(design.grooveColor))) {
    return 'Choose a valid plank groove colour.'
  }
  if (!validDoorTexture(design.leafTexture) || !validDoorTexture(design.panelTexture)) return 'Choose a valid door texture scale and rotation.'
  if (!Array.isArray(design.panels) || design.panels.length > 16) return 'Use up to 16 panels per leaf.'
  for (const panel of design.panels) {
    if (!panel || ![panel.left, panel.bottom, panel.width, panel.height].every(Number.isFinite) ||
      panel.left < .01 - 1e-8 || panel.bottom < .01 - 1e-8 || panel.left + panel.width > .99 + 1e-8 || panel.bottom + panel.height > .99 + 1e-8 ||
      panel.width * design.width < minPanelSize || panel.height * design.height < minPanelSize) return 'Each panel needs at least 25 mm in both directions and must stay inside the leaf.'
    if (!validDoorTexture(panel)) return 'Choose a valid panel texture scale and rotation.'
  }
  if (design.panels.some((a, index) => design.panels.slice(index + 1).some(b =>
    a.left < b.left + b.width - 1e-6 && b.left < a.left + a.width - 1e-6 &&
    a.bottom < b.bottom + b.height - 1e-6 && b.bottom < a.bottom + a.height - 1e-6))) return 'Panels must fit without overlapping.'
  return null
}

export function doorDefinition(id: string, name: string, design: DoorDesign): ModelDefinition {
  const error = validateDoorDesign(design)
  if (error) throw new Error(error)
  const opening = getDoorOpeningSize(design)
  const width = opening.width + DOOR_CASING_WIDTH * 2
  const depth = .1 + design.frameProjection * 2
  return { id, name: name.trim() || 'Oak door', category: 'My doors', objectType: 'interior-door',
    wallMount: 'interior-door', shape: 'box', color: '#c99e68', width, depth, height: opening.height,
    openingWidth: opening.width, doorLeafCount: design.leafCount, doorDesign: structuredClone(design),
    localBounds: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 },
    tags: ['oak', doorStyles[design.style].toLowerCase()], materialRegions: doorMaterialRegions,
  }
}
