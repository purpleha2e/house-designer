import type { PlacedModel } from './types'

// Shared by the plan and the 3D render loop without changing project state.
export type ModelTransformPreview = {
  modelId: string
  updates: Partial<PlacedModel>
  committed?: boolean
}
export type ModelTransformPreviewRef = { current: ModelTransformPreview | null }
