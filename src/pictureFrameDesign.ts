import type { ModelDefinition } from './models/modelLibrary'

export type PictureFrameDesign = {
  openingWidth: number
  openingHeight: number
  frameWidth: number
  frameDepth: number
  slipWidth: number
  slipDepth: number
  frameColor: string
  slipColor: string
}

export function createPictureFrameDesign(): PictureFrameDesign {
  return { openingWidth: .6, openingHeight: .45, frameWidth: .035, frameDepth: .028,
    slipWidth: .008, slipDepth: .016, frameColor: '#4b3528', slipColor: '#cfb792' }
}

export const pictureFrameMaterialRegions = [
  { id: 'hd_frame', label: 'Frame', sourceMaterialNames: ['hd_frame'] },
  { id: 'hd_slip', label: 'Slip', sourceMaterialNames: ['hd_slip'] },
  { id: 'hd_image', label: 'Image', sourceMaterialNames: ['hd_image'] },
]

export function getPictureFrameSize(design: PictureFrameDesign) {
  const border = 2 * (design.frameWidth + design.slipWidth)
  return { width: design.openingWidth + border, height: design.openingHeight + border, depth: design.frameDepth }
}

export function validatePictureFrameDesign(value: unknown) {
  if (!value || typeof value !== 'object') return 'A picture frame design is required.'
  const design = value as Partial<PictureFrameDesign>
  const inRange = (number: unknown, min: number, max: number): number is number =>
    typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max
  if (!inRange(design.openingWidth, .05, 3) || !inRange(design.openingHeight, .05, 3)) {
    return 'Picture width and height must be between 50 and 3000 mm.'
  }
  if (!inRange(design.frameWidth, .003, .25) || !inRange(design.frameDepth, .003, .2)) {
    return 'Frame width must be 3–250 mm and frame depth must be 3–200 mm.'
  }
  if (!inRange(design.slipWidth, 0, .1) || !inRange(design.slipDepth, 0, .2) ||
    (design.slipWidth > 0 && !inRange(design.slipDepth, .001, design.frameDepth))) {
    return 'Use a slip up to 100 mm wide and between 1 mm and the frame depth in thickness. Set its width to 0 to remove it.'
  }
  if (!/^#[0-9a-f]{6}$/i.test(design.frameColor ?? '') || !/^#[0-9a-f]{6}$/i.test(design.slipColor ?? '')) {
    return 'Choose valid colours for the frame and slip.'
  }
  return null
}

export function pictureFrameDefinition(id: string, name: string, design: PictureFrameDesign): ModelDefinition {
  const error = validatePictureFrameDesign(design)
  if (error) throw new Error(error)
  const size = getPictureFrameSize(design)
  return {
    id, name: name.trim() || 'Picture frame', category: 'Decoration', objectType: 'decor',
    color: design.frameColor, shape: 'box', placement: 'wall-mounted', ...size,
    pictureFrameDesign: { ...design },
    localBounds: { minX: -size.width / 2, maxX: size.width / 2, minZ: -size.depth / 2, maxZ: size.depth / 2 },
    materialRegions: getPictureFrameMaterialRegions(design),
  }
}

export function getPictureFrameMaterialRegions(design: PictureFrameDesign) {
  return design.slipWidth > 0 ? pictureFrameMaterialRegions : pictureFrameMaterialRegions.filter(region => region.id !== 'hd_slip')
}
