import type { ModelDefinition } from './models/modelLibrary'
import type { PlacedModel } from './types'

export const kitchenDoorStyles = { slab: 'Slab', shaker: 'Shaker', 'raised-panel': 'Raised panel' } as const
export const kitchenUnitTypes = { base: 'Base unit', wall: 'Wall unit' } as const
export const kitchenUnitLayouts = {
  'single-door': 'Single door', 'double-door': 'Double doors',
  'drawer-and-doors': 'Drawer + doors', 'three-drawers': 'Three drawers',
  'glass-front': 'Glass front with two shelves',
} as const
export const kitchenHandleStyles = { bar: 'Bar', 'rounded-bar': 'Rounded bar', knob: 'Knob', none: 'Handleless' } as const
export const kitchenHandleFinishes = {
  gold: { label: 'Gold', color: '#e4bc68', metalness: .92, roughness: .2, anisotropy: 0 },
  'brushed-gold': { label: 'Brushed gold', color: '#d6af64', metalness: .92, roughness: .43, anisotropy: .55 },
  silver: { label: 'Silver', color: '#d0d4d9', metalness: .95, roughness: .19, anisotropy: 0 },
  'brushed-silver': { label: 'Brushed silver', color: '#bdc3c8', metalness: .95, roughness: .42, anisotropy: .55 },
  bronze: { label: 'Bronze', color: '#b9a688', metalness: .78, roughness: .37, anisotropy: 0 },
  'brushed-bronze': { label: 'Brushed bronze', color: '#987657', metalness: .83, roughness: .49, anisotropy: .55 },
  black: { label: 'Black', color: '#252629', metalness: .34, roughness: .5, anisotropy: 0 },
} as const

export type KitchenUnitType = keyof typeof kitchenUnitTypes
type KitchenUnitLayout = keyof typeof kitchenUnitLayouts

export type KitchenUnitDesign = {
  unitType?: KitchenUnitType
  width: number
  depth: number
  height: number
  plinthHeight: number
  plinthInset: number
  worktopThickness: number
  frontRollRadius?: number
  frontOverhang: number
  sideOverhang: number
  layout: KitchenUnitLayout
  doorStyle: keyof typeof kitchenDoorStyles
  handleStyle: keyof typeof kitchenHandleStyles
  handleFinish?: keyof typeof kitchenHandleFinishes
  cabinetColor: string
  frontColor: string
  plinthColor: string
  worktopColor: string
  worktopMaterialId?: string
}

export function createKitchenUnitDesign(unitType: KitchenUnitType = 'base'): KitchenUnitDesign {
  return {
    unitType, width: .6, depth: unitType === 'wall' ? .35 : .6, height: unitType === 'wall' ? .72 : .9,
    plinthHeight: .15, plinthInset: .055,
    worktopThickness: .03, frontOverhang: .025, sideOverhang: 0,
    layout: 'double-door', doorStyle: 'shaker', handleStyle: 'bar', handleFinish: 'bronze',
    cabinetColor: '#dedbd3', frontColor: '#667c6d', plinthColor: '#667c6d', worktopColor: '#d3c9b9',
  }
}

export function getKitchenUnitLayouts(unitType: KitchenUnitType = 'base'): KitchenUnitLayout[] {
  return unitType === 'wall'
    ? ['single-door', 'double-door', 'glass-front']
    : ['single-door', 'double-door', 'drawer-and-doors', 'three-drawers']
}

export function copyKitchenUnitStyle(design: KitchenUnitDesign, source: KitchenUnitDesign): KitchenUnitDesign {
  const copyBaseDetails = design.unitType !== 'wall' && source.unitType !== 'wall'
  return {
    ...design,
    layout: getKitchenUnitLayouts(design.unitType).includes(source.layout) ? source.layout : design.layout,
    doorStyle: source.doorStyle,
    handleStyle: source.handleStyle,
    handleFinish: source.handleFinish,
    cabinetColor: source.cabinetColor,
    frontColor: source.frontColor,
    ...(copyBaseDetails && {
      plinthColor: source.plinthColor,
      plinthHeight: source.plinthHeight,
      plinthInset: source.plinthInset,
      worktopColor: source.worktopColor,
      worktopMaterialId: source.worktopMaterialId,
      worktopThickness: source.worktopThickness,
      frontRollRadius: source.frontRollRadius,
      frontOverhang: source.frontOverhang,
      sideOverhang: source.sideOverhang,
    }),
  }
}

export const kitchenUnitMaterialRegions = [
  { id: 'hd_cabinet', label: 'Cabinet', sourceMaterialNames: ['hd_cabinet'] },
  { id: 'hd_fronts', label: 'Doors and drawers', sourceMaterialNames: ['hd_fronts'] },
  { id: 'hd_worktop', label: 'Worktop', sourceMaterialNames: ['hd_worktop'] },
  { id: 'hd_plinth', label: 'Plinth', sourceMaterialNames: ['hd_plinth'] },
  { id: 'hd_handles', label: 'Handles', sourceMaterialNames: ['hd_handles'] },
]

const kitchenUnitDimensions = [
  { key: 'width', label: 'Cabinet width', min: .25, max: 2.4 },
  { key: 'depth', label: 'Cabinet depth', min: .25, max: 1.2 },
  { key: 'height', label: 'Overall height', min: .45, max: 2.5 },
  { key: 'plinthHeight', label: 'Plinth height', min: 0, max: .3 },
  { key: 'plinthInset', label: 'Plinth recess', min: 0, max: .15 },
  { key: 'worktopThickness', label: 'Worktop thickness', min: 0, max: .12 },
  { key: 'frontOverhang', label: 'Front overhang', min: 0, max: .35 },
  { key: 'sideOverhang', label: 'Side overhang', min: 0, max: .25 },
] as const

export function getKitchenUnitDimensions(unitType: KitchenUnitType = 'base') {
  if (unitType === 'base') return kitchenUnitDimensions
  const [width, depth, height] = kitchenUnitDimensions
  return [width, { ...depth, min: .15 }, { ...height, label: 'Cabinet height', min: .24 }] as const
}

export function getKitchenUnitConstruction(design: KitchenUnitDesign) {
  return design.unitType === 'wall'
    ? { plinthHeight: 0, worktopThickness: 0 }
    : { plinthHeight: design.plinthHeight, worktopThickness: design.worktopThickness }
}

export function validateKitchenUnitDesign(value: unknown) {
  if (!value || typeof value !== 'object') return 'A kitchen unit design is required.'
  const design = value as KitchenUnitDesign
  if (design.unitType !== undefined && !Object.hasOwn(kitchenUnitTypes, design.unitType)) return 'Choose a valid kitchen unit type.'
  for (const { key, label, min, max } of getKitchenUnitDimensions(design.unitType)) {
    if (!Number.isFinite(design[key]) || design[key] < min || design[key] > max) {
      return `${label} must be between ${min * 1000} and ${max * 1000} mm.`
    }
  }
  const radius = design.frontRollRadius ?? 0
  if (design.unitType !== 'wall' && (!Number.isFinite(radius) || radius < 0 || radius > .12 ||
    (design.worktopThickness > 0 && radius > design.worktopThickness))) {
    return 'The front roll radius must be between 0 and the worktop thickness.'
  }
  const { plinthHeight, worktopThickness } = getKitchenUnitConstruction(design)
  const bodyHeight = design.height - plinthHeight - worktopThickness
  if (bodyHeight < .24) return 'Leave at least 240 mm for the cabinet above the plinth and below the worktop.'
  if (!Object.hasOwn(kitchenDoorStyles, design.doorStyle) || !Object.hasOwn(kitchenUnitLayouts, design.layout) ||
    !Object.hasOwn(kitchenHandleStyles, design.handleStyle)) return 'Choose a valid front layout, door style and handle.'
  // Saved wall units may still use drawer layouts from before the wall-specific choices.
  if (design.layout === 'glass-front' && design.unitType !== 'wall') return 'Choose a wall unit for a glass front.'
  if (design.handleFinish !== undefined && !Object.hasOwn(kitchenHandleFinishes, design.handleFinish)) return 'Choose a valid handle finish.'
  for (const color of [design.cabinetColor, design.frontColor, design.plinthColor, design.worktopColor]) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return 'Choose valid colours for the kitchen unit.'
  }
  if (design.worktopMaterialId !== undefined && (typeof design.worktopMaterialId !== 'string' || !design.worktopMaterialId.trim())) {
    return 'Choose a valid worktop material.'
  }
  return null
}

export function getKitchenHandleFinish(design: KitchenUnitDesign) {
  return kitchenHandleFinishes[design.handleFinish ?? 'bronze']
}

export function getKitchenUnitSize(design: KitchenUnitDesign) {
  const { worktopThickness } = getKitchenUnitConstruction(design)
  return { width: design.width + (worktopThickness ? design.sideOverhang * 2 : 0),
    depth: design.depth + (worktopThickness ? design.frontOverhang : 0), height: design.height }
}

export function getKitchenUnitBounds(design: KitchenUnitDesign) {
  const { width, depth } = getKitchenUnitSize(design)
  return { minX: -width / 2, maxX: width / 2, minZ: 0, maxZ: depth }
}

/** Move the saved pivot from the middle to the rear without moving the cabinet itself. */
export function withKitchenUnitBackOrigin(model: PlacedModel, design: KitchenUnitDesign): PlacedModel {
  if (model.kitchenUnitOrigin === 'back') return model
  const halfDepth = getKitchenUnitSize(design).depth * model.scale * (model.depthScale ?? 1) / 2
  const setback = model.flipped ? -halfDepth : halfDepth
  return {
    ...model, kitchenUnitOrigin: 'back',
    position: { x: model.position.x + setback * Math.sin(model.rotation), y: model.position.y - setback * Math.cos(model.rotation) },
  }
}

export function getKitchenUnitMaterialRegions(design: KitchenUnitDesign) {
  const { plinthHeight, worktopThickness } = getKitchenUnitConstruction(design)
  return kitchenUnitMaterialRegions.filter(region =>
    (region.id !== 'hd_worktop' || worktopThickness > 0) &&
    (region.id !== 'hd_plinth' || plinthHeight > 0) &&
    (region.id !== 'hd_handles' || design.handleStyle !== 'none'))
}

export function kitchenUnitDefinition(id: string, name: string, design: KitchenUnitDesign): ModelDefinition {
  const error = validateKitchenUnitDesign(design)
  if (error) throw new Error(error)
  const size = getKitchenUnitSize(design)
  return {
    id, name: name.trim() || 'Kitchen unit', category: 'Kitchen', objectType: 'kitchen',
    placement: design.unitType === 'wall' ? 'wall-mounted' : 'floor',
    color: design.frontColor, shape: 'box', ...size, kitchenUnitDesign: { ...design },
    localBounds: getKitchenUnitBounds(design),
    tags: ['cabinet', kitchenDoorStyles[design.doorStyle].toLowerCase(), kitchenUnitLayouts[design.layout].toLowerCase()],
    materialRegions: getKitchenUnitMaterialRegions(design),
  }
}
