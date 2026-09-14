import { useMemo } from 'react'
import type { FloorLevel, RoofEndConnection, RoofStructure } from '../types'
import type { ResolvedRoof } from '../roofJunctions'
import { resolveBuildingRoofs } from '../roofBuildingGeometry'

export function RoofConnectionFields({ roof, floors, onChange, resolvedRoof }: {
  roof: RoofStructure
  resolvedRoof?: ResolvedRoof
  floors: FloorLevel[]
  onChange: (updates: Partial<RoofStructure>) => void
}) {
  const roofs = useMemo(() => floors.flatMap((floor) => (floor.roofs ?? []).map((candidate, index) => ({
    roof: candidate, label: `${floor.name} · Roof ${index + 1} (${candidate.type})`,
  }))), [floors])
  const resolved = useMemo(() => resolvedRoof ?? resolveBuildingRoofs(floors).find((candidate) => candidate.roof.id === roof.id)?.resolved, [roof.id, floors, resolvedRoof])
  if (roof.type !== 'up-and-over') return null
  return <div className="roof-connections" aria-label="Ridge connections">
    {(['ridgeStart', 'ridgeEnd'] as const).map((end, index) => {
      const connection = roof[end] ?? { mode: 'automatic' }
      const status = resolved?.connections.find((candidate) => candidate.end === end)
      const target = status?.targetRoofId && roofs.find((candidate) => candidate.roof.id === status.targetRoofId)
      const set = (value: RoofEndConnection) => onChange({ [end]: value })
      return <div className="roof-connection" key={end}>
        <label>End {index === 0 ? 'A' : 'B'}
          <select aria-label={`Ridge end ${index === 0 ? 'A' : 'B'}`} value={connection.mode}
            onChange={(event) => set(event.target.value === 'join' ? { mode: 'join', targetRoofId: '' } : { mode: event.target.value as 'automatic' | 'exposed' })}>
            <option value="automatic">Automatic</option>
            <option value="exposed">Exposed gable</option>
            <option value="join">Join roof…</option>
          </select>
        </label>
        {connection.mode === 'join' && <label>Connect to
          <select aria-label={`Target for ridge end ${index === 0 ? 'A' : 'B'}`} value={connection.targetRoofId}
            onChange={(event) => set({ mode: 'join', targetRoofId: event.target.value })}>
            <option value="">Choose a roof</option>
            {connection.targetRoofId && !roofs.some((candidate) => candidate.roof.id === connection.targetRoofId) && <option value={connection.targetRoofId}>Missing roof</option>}
            {roofs.filter((candidate) => candidate.roof.id !== roof.id).map((candidate) => <option value={candidate.roof.id} key={candidate.roof.id}>{candidate.label}</option>)}
          </select>
        </label>}
        <small role="status" className={status?.state === 'unresolved' ? 'roof-connection-warning' : undefined}>
          {status?.state === 'joined' ? `Joins ${target ? target.label : 'roof'}` : status?.message ?? 'Finishes at the gable'}
        </small>
      </div>
    })}
  </div>
}
