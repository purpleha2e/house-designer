export type EditorLightingView = 'build' | 'lighting' | 'custom'
export type EditorViewQuality = 'balanced' | 'faster'
export const EDITOR_VIEW_QUALITY_STORAGE = 'house-designer-view-quality-v1'

/** Editor display policy, separate from authored sun/lamps and the GI cache.
 * Opening a project starts in Build; old experimental device settings cannot
 * silently change that baseline. Published views retain their saved settings. */
export const EDITOR_LIGHTING_VIEWS = {
 build: { label: 'Build', description: 'Clear interiors for designing and placing furniture.', fill: .16, exposure: .5, adapt: false },
 lighting: { label: 'Lighting preview', description: 'Preview daylight and room lights with shadows and automatic exposure.', fill: 0, exposure: 1, adapt: true },
} as const

export function editorLightingDisplay(view: EditorLightingView, savedExposure: number, savedAdapt: boolean, brightness = 0) {
 if(view==='custom')return {exposure:savedExposure,adapt:savedAdapt}
 const preset=EDITOR_LIGHTING_VIEWS[view]
 return {exposure:preset.exposure+Math.max(-1,Math.min(1,brightness)),adapt:preset.adapt}
}

export function editorLightingOverrides(view: EditorLightingView) {
 if(view==='custom')return {}
 const preset=EDITOR_LIGHTING_VIEWS[view]
 return {ambientTerm:preset.fill,nightAmbientTerm:preset.fill,ambientOcclusion:true,ambientOcclusionIntensity:.25,lightShadows:true}
}

export function normalizeEditorViewQuality(value:unknown):EditorViewQuality{return value==='faster'?'faster':'balanced'}
export function editorResolutionScale(quality:EditorViewQuality,navigation:number){return Math.min(quality==='faster'?.7:1,navigation)}
