export const LIGHTING_REFINEMENT_LEVELS=['fast','balanced','high','ultra'] as const
export type LightingRefinementQuality=typeof LIGHTING_REFINEMENT_LEVELS[number]
export const LIGHTING_REFINEMENT_STORAGE='house-designer-lighting-refinement-v1'
/** Device preference, independent of the house and its portable probe bake. */
export const LIGHTING_REFINEMENT={
 fast:{label:'Fast — probes only',dimension:0,rays:0,bounces:0},
 balanced:{label:'Balanced — still view',dimension:64,rays:32,bounces:4},
 high:{label:'High — detailed refinement',dimension:96,rays:64,bounces:6},
 ultra:{label:'Ultra — slowest refinement',dimension:128,rays:128,bounces:8},
} as const
export function normalizeLightingRefinement(value:unknown):LightingRefinementQuality{
 return LIGHTING_REFINEMENT_LEVELS.includes(value as LightingRefinementQuality)?value as LightingRefinementQuality:'fast'
}
export function lightingRefinementPasses(rays:number){
 const passes:number[]=rays>4?[4]:[];for(let count=16;count<rays;count*=2)passes.push(count)
 if(rays>0)passes.push(rays);return passes
}

/** Progress belongs to the small status labels, not the entire house's React
 * tree. Texture/worker messages can arrive several times per display frame. */
export function createLightingRefinementStatus(){
 let value=''
 const listeners=new Set<()=>void>()
 return{
  get:()=>value,
  set:(next:string)=>{if(next===value)return;value=next;listeners.forEach(listener=>listener())},
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
 }
}
