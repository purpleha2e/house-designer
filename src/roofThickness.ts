import type { RoofStructure } from './types.ts'

export const DEFAULT_ROOF_THICKNESS_METERS = 0.04
export function getRoofThickness(roof: Pick<RoofStructure, 'thickness'>) {
  return typeof roof.thickness === 'number' && Number.isFinite(roof.thickness)
    ? Math.min(1, Math.max(0.01, roof.thickness)) : DEFAULT_ROOF_THICKNESS_METERS
}
