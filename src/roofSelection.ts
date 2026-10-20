import type { MeshBasicMaterialParameters } from 'three'

export const roofSurfaceHighlightRoles = new Set([
  'roof-exterior-highlight', 'roof-underside-highlight',
  'roof-gable-highlight', 'roof-gable-interior-highlight',
])

// Shared by the live overlays and the startup prototypes, so the first roof
// selection reuses a prepared transparent shader instead of compiling on click.
export const roofSurfaceHighlightMaterialParameters = {
  color: 0x3b82f6, depthTest: true, depthWrite: false, opacity: .28,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, transparent: true,
} satisfies MeshBasicMaterialParameters
