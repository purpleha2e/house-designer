import { useMemo, useState } from 'react'
import type { FloorLevel, RoofStructure } from '../types'
import { resolveBuildingRoofs, type BuildingRoof } from '../roofBuildingGeometry'
import { getGableRidgeHeight, getGableRidgeX, getPitchedRoofHeightAtX, getPitchedRoofSideSlope } from '../roofProfile'
import { roofJunctionInput } from '../roofJunctions'
import { ROOF_TYPE_LABELS } from '../roofLabels'

function SignedNumber({ value, label, disabled, limit, onChange }: {
  value: number; label: string; disabled?: boolean; limit?: number; onChange: (value: number) => void
}) {
  const displayed = Number(value.toFixed(6))
  const [edit, setEdit] = useState({ value: displayed, draft: String(displayed) })
  if (edit.value !== displayed) {
    setEdit({ value: displayed, draft: Number.parseFloat(edit.draft) === displayed ? edit.draft : String(displayed) })
  }
  return <input aria-label={label} type="number" step="0.05" disabled={disabled} value={edit.draft}
    min={limit === undefined ? undefined : -limit} max={limit}
    onChange={event => {
      setEdit({ value: displayed, draft: event.target.value })
      const parsed = Number.parseFloat(event.target.value)
      if (Number.isFinite(parsed)) onChange(limit === undefined ? parsed : Math.max(-limit, Math.min(limit, parsed)))
    }} onBlur={() => setEdit({ value: displayed, draft: String(displayed) })} />
}

export function RoofRidgeFields({ roof, floors, floorId, candidate, onChange, section = 'all' }: {
  roof: RoofStructure; floors: FloorLevel[]; floorId: string; candidate?: BuildingRoof
  onChange: (updates: Partial<RoofStructure>) => void
  section?: 'all' | 'shape' | 'height' | 'advanced'
}) {
  const resolved = useMemo(() => candidate ?? resolveBuildingRoofs(floors.map(floor => floor.id === floorId
    ? { ...floor, roofs: [...(floor.roofs ?? []).filter(item => item.id !== roof.id), roof] } : floor))
    .find(item => item.roof.id === roof.id), [candidate, floors, floorId, roof])
  if (roof.type !== 'up-and-over') return null
  const effective = resolved?.roof ?? roof
  const support = resolved?.resolved.support ?? roofJunctionInput(roof, floorId, 0).support
  const offset = getGableRidgeX(effective, support) - (support.minX + support.maxX) / 2
  const height = getGableRidgeHeight(effective, support)
  const floor = floors.find(item => item.id === floorId)
  const eaveHeight = (x: number) => (floor?.roomHeight ?? 0) + (effective.heightOffset ?? 0) +
    getPitchedRoofHeightAtX(effective, support, x)
  const targets = floors.flatMap(floor => (floor.roofs ?? []).map((item, index) => ({
    id: item.id, label: `${floor.name} · Roof ${index + 1} (${ROOF_TYPE_LABELS[item.type]})`,
  }))).filter(item => item.id !== roof.id)
  return <fieldset className="roof-ridge-fields">
    {(section === 'all' || section === 'shape') && <>
    <label className="roof-pitch-link" title="Keep a shared ridge while allowing one slope to reach a lower eave.">
      <input aria-label="Asymmetric roof sides" type="checkbox" checked={roof.asymmetricSides === true}
        onChange={event => onChange({ asymmetricSides: event.target.checked,
          ...(event.target.checked ? { ridgeHeight: height, mountSide: roof.mountSide ?? 'free' } : {}) })} />
      <span>Unequal eave heights</span>
    </label>
    {section === 'shape' && roof.asymmetricSides && <small>Both sides share a ridge. Set their heights in Height &amp; joins.</small>}
    </>}
    {roof.asymmetricSides && <>
      {(section === 'all' || section === 'advanced') && <>
      <label className="roof-pitch-field">
        <span>Pitch / eave constraint</span>
        <select aria-label="Roof mounted side" value={roof.mountSide ?? 'auto'}
          onChange={event => onChange({ mountSide: event.target.value as RoofStructure['mountSide'] })}>
          <option value="auto">Shorter side (automatic)</option>
          <option value="side1">Side 1</option>
          <option value="side2">Side 2</option>
          <option value="free">Keep both side pitches (free eaves)</option>
        </select>
      </label>
      {roof.mountSide === 'free'
        ? <small>Both sides use the selected roof pitch. Ridge height and offset determine the eave heights.</small>
        : <small>The mounted side's pitch adjusts to meet the ridge. Choose “Keep both side pitches” to use the selected pitch on both slopes.</small>}
      <label className="roof-pitch-field" title="Distance from the footprint centre. Positive moves towards side 2; negative towards side 1. The ridge height stays fixed.">
        <span>Ridge offset (m)</span>
        <SignedNumber label="Roof ridge offset" value={offset} disabled={resolved?.heightAlignmentStatus?.state === 'linked' && roof.heightAlignment?.mode === 'eave'}
          limit={Math.max(0, (support.maxX - support.minX) / 2 - 0.05)}
          onChange={ridgeOffset => onChange({ ridgeOffset })} />
      </label>
      </>}
      {(section === 'all' || section === 'height') && <>
      <label className="roof-pitch-field">
        <span>Ridge height</span>
        <select aria-label="Match roof ridge height" value={roof.ridgeHeightTargetRoofId ?? ''}
          onChange={event => onChange({ ridgeHeightTargetRoofId: event.target.value || undefined, ridgeHeight: height })}>
          <option value="">Manual height</option>
          {roof.ridgeHeightTargetRoofId && !targets.some(item => item.id === roof.ridgeHeightTargetRoofId) &&
            <option value={roof.ridgeHeightTargetRoofId}>Missing roof</option>}
          {targets.map(item => <option key={item.id} value={item.id}>Match {item.label}</option>)}
        </select>
      </label>
      {section === 'height' && resolved?.ridgeHeightLink?.state === 'linked'
        ? <small>Ridge height follows the matching roof (<output aria-label="Matched roof ridge height">{(height + (effective.heightOffset ?? 0)).toFixed(2)}</output> m above wall tops).</small>
        : <label className="roof-pitch-field" title="Ridge height relative to this floor's normal wall tops. The vertical offset still moves a roof with a manual ridge height.">
        <span>Above wall tops (m)</span>
        <SignedNumber label="Roof ridge height" value={height + (effective.heightOffset ?? 0)}
          disabled={resolved?.ridgeHeightLink?.state === 'linked'}
          onChange={value => onChange({ ridgeHeight: value - (roof.heightOffset ?? 0) })} />
      </label>}
      </>}
      {(section === 'all' || section === 'height') && <>
      <div className="roof-eave-heights" aria-label="Eave heights above floor">
        <span>Eaves above floor</span>
        <span>Side 1: <output aria-label="Side 1 eave height">{eaveHeight(support.minX).toFixed(2)} m</output></span>
        <span>Side 2: <output aria-label="Side 2 eave height">{eaveHeight(support.maxX).toFixed(2)} m</output></span>
      </div>
      </>}
      {(section === 'all' || section === 'shape') && <>
      <div className="roof-eave-heights" aria-label="Effective roof pitches">
        <span>Side pitches</span>
        <span>Side 1: {(Math.atan(getPitchedRoofSideSlope(effective, support, support.minX)) * 180 / Math.PI).toFixed(1)}°</span>
        <span>Side 2: {(Math.atan(getPitchedRoofSideSlope(effective, support, support.maxX)) * 180 / Math.PI).toFixed(1)}°</span>
      </div>
      </>}
      {(section === 'all' || section === 'height') && <>
      {!roof.fitSupportingWalls && Math.min(eaveHeight(support.minX), eaveHeight(support.maxX)) < (floor?.roomHeight ?? 0) - 0.001 &&
        <small role="status">An eave is below the wall tops. Enable “Fit supporting walls to roof” to trim the walls and ceiling beneath it.</small>}
      {resolved?.ridgeHeightLink?.state === 'unresolved' &&
        <small role="status" className="roof-connection-warning">{resolved.ridgeHeightLink.message}</small>}
      </>}
    </>}
  </fieldset>
}
