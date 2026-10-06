import type { RoofStructure } from './types.ts'

export const ROOF_TYPE_LABELS: Record<RoofStructure['type'], string> = {
  'up-and-over': 'Gable', hip: 'Hipped', 'lean-to': 'Lean-to', flat: 'Flat', bay: 'Bay',
}
