export type IndirectPreparationStage = 'layout' | 'geometry' | 'structure' | 'probes' | 'ceilings' | 'lamps' | 'tables' | 'zones' | 'ready'
export type IndirectPreparationProgress = { stage: IndirectPreparationStage; timings: Partial<Record<IndirectPreparationStage, number>> }

export const indirectPreparationLabels: Record<IndirectPreparationStage, string> = {
  layout: 'placing probes', geometry: 'indexing scene geometry', structure: 'indexing ceilings and roofs',
  probes: 'checking probe clearance', ceilings: 'checking ceiling heights', lamps: 'checking lamp visibility',
  tables: 'preparing lighting tables', zones: 'finding affected lighting zones', ready: 'finishing preparation',
}

export function createIndirectPreparationTimer(onProgress?: (progress: IndirectPreparationProgress) => void) {
  const timings: IndirectPreparationProgress['timings'] = {}
  let stage: IndirectPreparationStage | undefined, started = performance.now()
  return { timings, start(next: IndirectPreparationStage) {
    const now = performance.now()
    if (stage) timings[stage] = now - started
    stage = next; started = now
    onProgress?.({ stage: next, timings: { ...timings } })
  } }
}
