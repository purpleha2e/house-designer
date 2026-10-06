import type { FloorLevel, RoofStructure } from '../types'
import type { BuildingRoof } from '../roofBuildingGeometry'
import { ROOF_TYPE_LABELS } from '../roofLabels'

export function RoofAlignmentFields({ roof, floors, candidate, onChange }: {
  roof: RoofStructure; floors: FloorLevel[]; candidate?: BuildingRoof
  onChange: (updates: Partial<RoofStructure>) => void
}) {
  if (roof.type !== 'up-and-over') return null
  const alignment = roof.heightAlignment
  const status = candidate?.heightAlignmentStatus
  const effective = candidate?.roof ?? roof
  const targets = floors.flatMap(floor => (floor.roofs ?? []).filter(r => r.id !== roof.id)
    .map(r => ({ id: r.id, label: `${floor.name} · Roof ${(floor.roofs ?? []).indexOf(r) + 1} (${ROOF_TYPE_LABELS[r.type]})` })))
  const joinedTarget = [roof.ridgeStart, roof.ridgeEnd].find(end => end?.mode === 'join')
  const defaultTarget = joinedTarget?.mode === 'join' ? joinedTarget.targetRoofId : roof.ridgeHeightTargetRoofId ?? ''
  const disable = () => onChange({ heightAlignment: undefined,
    heightOffset: effective.heightOffset, ridgeOffset: effective.ridgeOffset, ridgeHeight: effective.ridgeHeight })
  return <fieldset className="roof-ridge-fields" aria-label="Roof alignment settings">
    <label className="roof-pitch-field">
      <span>Align with another roof</span>
      <select aria-label="Roof height alignment" value={alignment?.mode === 'eave' ? alignment.side : alignment?.mode ?? ''}
        onChange={event => {
          const mode = event.target.value
          if (!mode) { disable(); return }
          const targetRoofId = alignment?.targetRoofId ?? defaultTarget
          onChange({ heightAlignment: mode === 'slope' ? { mode, targetRoofId }
            : { mode: 'eave', side: mode as 'side1' | 'side2', targetRoofId },
            ...(mode !== 'slope' ? { asymmetricSides: true, mountSide: 'free' } : {}) })
        }}>
        <option value="">Manual settings</option>
        <option value="slope">Match adjoining slope</option>
        <option value="side1">Match side 1 eave</option>
        <option value="side2">Match side 2 eave</option>
      </select>
    </label>
    {alignment && <>
      <label className="roof-pitch-field">
        <span>Match roof</span>
        <select aria-label="Roof alignment target" value={alignment.targetRoofId}
          onChange={event => onChange({ heightAlignment: { ...alignment, targetRoofId: event.target.value } })}>
          <option value="">Choose a roof</option>
          {alignment.targetRoofId && !targets.some(r => r.id === alignment.targetRoofId) &&
            <option value={alignment.targetRoofId}>Missing roof</option>}
          {targets.map(r => <option value={r.id} key={r.id}>{r.label}</option>)}
        </select>
      </label>
      <small>{alignment.mode === 'slope'
        ? 'Moves this roof vertically so its matching slope continues the adjoining roof. Both pitches stay unchanged.'
        : 'Moves the ridge sideways to match the nearest target eave. Keeps the ridge height and both side pitches.'}</small>
      <small role="status" className={status?.state === 'unresolved' ? 'roof-connection-warning' : undefined}>
        {status?.state === 'linked' ? 'Aligned automatically. Follows changes to the matching roof.'
          : status?.message ?? 'Choose the roof to match.'}
      </small>
    </>}
  </fieldset>
}
