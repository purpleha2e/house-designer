import { useState } from 'react'
import type { RoofEndChamfer, RoofStructure } from '../types'
import { getRoofThickness } from '../roofThickness'
import { getGableChamferLimits, type RoofBounds } from '../roofProfile'

const DEFAULT_CHAMFER_DISTANCE_METERS = 0.5

export function RoofPitchFields({
  roof,
  onChange,
  bayRidgeMaxLength,
  chamferGeometry,
  alignedHeightOffset,
  section = 'all',
}: {
  roof: Pick<RoofStructure, 'type' | 'heightOffset' | 'fitSupportingWalls' | 'thickness' | 'clipsGeometry' | 'bayRidgeLength' | 'pitchDegrees' | 'overhangPitchDegrees' | 'soffitColor' | 'ridgeStartChamfer' | 'ridgeEndChamfer'>
  onChange: (updates: Partial<RoofStructure>) => void
  bayRidgeMaxLength?: number
  chamferGeometry?: { roof: RoofStructure; extents: RoofBounds; support: RoofBounds }
  alignedHeightOffset?: number
  section?: 'all' | 'shape' | 'walls' | 'chamfer' | 'advanced'
}) {
  const heightOffset = alignedHeightOffset ?? roof.heightOffset ?? 0
  const [offsetEdit, setOffsetEdit] = useState({ value: heightOffset, draft: String(heightOffset) })
  if (offsetEdit.value !== heightOffset) setOffsetEdit({ value: heightOffset,
    draft: Number.parseFloat(offsetEdit.draft) === heightOffset ? offsetEdit.draft : String(heightOffset) })
  return (
    <>
      {(section === 'all' || section === 'advanced') && <>
      <label className="roof-pitch-field" title="Negative values lower the whole roof from the floor's normal wall-top height; positive values raise it.">
        <span>Vertical offset (m)</span>
        <input aria-label="Roof vertical offset" type="number" step="0.05"
          value={alignedHeightOffset !== undefined ? String(heightOffset) : offsetEdit.draft} disabled={alignedHeightOffset !== undefined}
          onChange={event => {
            setOffsetEdit({ value: heightOffset, draft: event.target.value })
            const value = Number.parseFloat(event.target.value)
            if (Number.isFinite(value)) onChange({ heightOffset: value })
          }}
          onBlur={() => setOffsetEdit({ value: heightOffset, draft: String(heightOffset) })} />
      </label>
      </>}
      {(section === 'all' || section === 'walls') && <>
      <label className="roof-pitch-link" title="Trim supporting wall tops on this floor to the roof underside. Taller adjoining facades stay independent. This also works with house clipping turned off.">
        <input aria-label="Fit supporting walls to roof" type="checkbox" checked={roof.fitSupportingWalls === true}
          onChange={event => onChange({ fitSupportingWalls: event.target.checked })} />
        <span>Fit supporting walls to roof</span>
      </label>
      </>}
      {(section === 'all' || section === 'advanced') && <>
      <label className="roof-pitch-link" title="Turn off for a roof that should fit against the house without trimming its walls, floors or other roofs.">
        <input type="checkbox" checked={roof.clipsGeometry !== false}
          onChange={(event) => onChange({ clipsGeometry: event.target.checked })} />
        <span>Clip house geometry</span>
      </label>
      <label className="roof-pitch-field">
        <span>Roof thickness (m)</span>
        <input type="number" min="0.01" max="1" step="0.01" value={getRoofThickness(roof)}
          onChange={(event) => {
            const thickness = Number.parseFloat(event.target.value)
            if (Number.isFinite(thickness)) onChange({ thickness: getRoofThickness({ thickness }) })
          }} />
      </label>
      </>}
      {roof.type !== 'flat' ? <>
      {(section === 'all' || section === 'shape') && <>
      {roof.type === 'bay' ? <label className="roof-pitch-field" title="Distance from the midpoint of the mounting edge towards the front of the bay. Zero gives a pointed roof.">
        <span>Ridge length (m)</span>
        <input aria-label="Bay roof ridge length" type="number" min="0" max={bayRidgeMaxLength} step="0.05"
          value={Math.min(bayRidgeMaxLength ?? Infinity, roof.bayRidgeLength ?? 0)}
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value)
            if (Number.isFinite(value)) onChange({ bayRidgeLength: Math.min(bayRidgeMaxLength ?? Infinity, Math.max(0, value)) })
          }} />
      </label> : null}
      <label className="roof-pitch-field">
        <span>Pitch (°)</span>
        <input
          aria-label="Roof pitch"
          type="number"
          min="1"
          max="75"
          step="1"
          value={roof.pitchDegrees}
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value)
            if (Number.isFinite(value)) {
              onChange({ pitchDegrees: Math.min(75, Math.max(1, value)) })
            }
          }}
        />
      </label>
      </>}
      {(section === 'all' || section === 'advanced') && <>
      <label className="roof-pitch-field">
        <span>Overhang pitch (°)</span>
        <input
          disabled={section !== 'all' && roof.overhangPitchDegrees === undefined}
          type="number"
          min="0"
          max="75"
          step="1"
          value={roof.overhangPitchDegrees ?? roof.pitchDegrees}
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value)
            if (Number.isFinite(value)) {
              onChange({ overhangPitchDegrees: Math.min(75, Math.max(0, value)) })
            }
          }}
        />
      </label>
      <label className="roof-pitch-link">
        <input
          aria-label="Match overhang to roof pitch"
          type="checkbox"
          checked={roof.overhangPitchDegrees === undefined}
          onChange={(event) => onChange({
            overhangPitchDegrees: event.target.checked ? undefined : roof.pitchDegrees,
          })}
        />
        <span>Use roof pitch for overhangs</span>
      </label>
      </>}
      {roof.type === 'up-and-over' || roof.type === 'bay' ? (
        <>
          {(section === 'all' || section === 'advanced') && <>
          <label className="roof-pitch-field">
            <span>Soffit / fascia colour</span>
            <input
              type="color"
              value={roof.soffitColor ?? '#ffffff'}
              onChange={(event) => onChange({ soffitColor: event.target.value })}
            />
          </label>
          </>}
          {(section === 'all' || section === 'chamfer') && <>
          {(roof.type === 'up-and-over' ? ['ridgeStartChamfer', 'ridgeEndChamfer'] as const : []).map((field, index) => {
            const chamfer = roof[field]
            const limits = chamferGeometry ? getGableChamferLimits(chamferGeometry.roof,
              chamferGeometry.extents, chamferGeometry.support)[field] : undefined
            const setChamfer = (value: RoofEndChamfer | undefined) => {
              if (value && chamferGeometry) {
                const otherField = field === 'ridgeStartChamfer' ? 'ridgeEndChamfer' : 'ridgeStartChamfer'
                const current = getGableChamferLimits(chamferGeometry.roof, chamferGeometry.extents, chamferGeometry.support)
                const other = roof[otherField]
                const effectiveOther = other ? { ...other, distance: current[otherField].distance } : undefined
                const updatedRoof = { ...chamferGeometry.roof, [otherField]: effectiveOther,
                  [field]: { ...value, matchEave: false, distance: 0 } }
                const updated = getGableChamferLimits(updatedRoof, chamferGeometry.extents, chamferGeometry.support)
                onChange({ [field]: { ...value, distance: Math.min(value.distance, updated[field].maximum) },
                  ...(other && effectiveOther && other.distance !== effectiveOther.distance ? { [otherField]: effectiveOther } : {}) })
                return
              }
              onChange({ [field]: value })
            }

            return (
              <fieldset className="roof-chamfer-fields" key={field}>
                <label className="roof-pitch-link">
                  <input
                    type="checkbox"
                    checked={chamfer !== undefined}
                    onChange={(event) => setChamfer(event.target.checked ? {
                      angleDegrees: roof.pitchDegrees,
                      distance: DEFAULT_CHAMFER_DISTANCE_METERS,
                    } : undefined)}
                  />
                  <span>Chamfer end {index === 0 ? 'A' : 'B'}</span>
                </label>
                {chamfer ? (
                  <div className="roof-chamfer-values">
                    <label className="roof-pitch-link">
                      <input aria-label={`Match chamfer end ${index === 0 ? 'A' : 'B'} eave`} type="checkbox"
                        checked={chamfer.matchEave === true}
                        onChange={event => setChamfer({ ...chamfer, matchEave: event.target.checked,
                          distance: limits?.distance ?? chamfer.distance })} />
                      <span>Match higher side eave</span>
                    </label>
                    <label className="roof-pitch-field">
                      <span>Angle (°)</span>
                      <input
                        aria-label={`Chamfer end ${index === 0 ? 'A' : 'B'} angle`}
                        type="number"
                        min="1"
                        max="75"
                        step="1"
                        value={chamfer.angleDegrees}
                        onChange={(event) => {
                          const value = Number.parseFloat(event.target.value)
                          if (Number.isFinite(value)) setChamfer({
                            ...chamfer,
                            angleDegrees: Math.min(75, Math.max(1, value)),
                          })
                        }}
                      />
                    </label>
                    <label className="roof-pitch-field" hidden={section === 'chamfer' && chamfer.matchEave === true}>
                      <span>Setback (m)</span>
                      <input
                        aria-label={`Chamfer end ${index === 0 ? 'A' : 'B'} setback`}
                        disabled={chamfer.matchEave === true}
                        type="number"
                        min="0"
                        max={limits?.maximum}
                        step="0.05"
                        value={Number((limits?.distance ?? chamfer.distance).toFixed(6))}
                        onChange={(event) => {
                          const value = Number.parseFloat(event.target.value)
                          if (Number.isFinite(value)) setChamfer({
                            ...chamfer,
                            distance: Math.max(0, value),
                          })
                        }}
                      />
                    </label>
                    {chamfer.matchEave && <small>Setback follows the ridge, angle and higher side eave automatically.</small>}
                    {limits && !chamfer.matchEave && <small>Maximum {limits.maximum.toFixed(2)} m — remaining roof length. Deeper chamfers lower the eave.</small>}
                    {limits && !chamfer.matchEave && chamfer.distance > limits.distance + 0.000001 &&
                      <small role="status">Setback limited to {limits.distance.toFixed(2)} m.</small>}
                  </div>
                ) : null}
              </fieldset>
            )
          })}
          </>}
        </>
      ) : null}
      </> : null}
    </>
  )
}
