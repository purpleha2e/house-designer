import { useEffect, useState } from 'react'
import type { RoofEndChamfer, RoofStructure } from '../types'
import { getRoofThickness } from '../roofThickness'

const DEFAULT_CHAMFER_DISTANCE_METERS = 0.5

export function RoofPitchFields({
  roof,
  onChange,
  bayRidgeMaxLength,
}: {
  roof: Pick<RoofStructure, 'type' | 'heightOffset' | 'fitSupportingWalls' | 'thickness' | 'clipsGeometry' | 'bayRidgeLength' | 'pitchDegrees' | 'overhangPitchDegrees' | 'soffitColor' | 'ridgeStartChamfer' | 'ridgeEndChamfer'>
  onChange: (updates: Partial<RoofStructure>) => void
  bayRidgeMaxLength?: number
}) {
  const heightOffset = roof.heightOffset ?? 0
  const [offsetDraft, setOffsetDraft] = useState(String(heightOffset))
  useEffect(() => setOffsetDraft(current => Number.parseFloat(current) === heightOffset ? current : String(heightOffset)), [heightOffset])
  return (
    <>
      <label className="roof-pitch-field" title="Negative values lower the whole roof from the floor's normal wall-top height; positive values raise it.">
        <span>Vertical offset (m)</span>
        <input aria-label="Roof vertical offset" type="number" step="0.05" value={offsetDraft}
          onChange={event => {
            setOffsetDraft(event.target.value)
            const value = Number.parseFloat(event.target.value)
            if (Number.isFinite(value)) onChange({ heightOffset: value })
          }}
          onBlur={() => setOffsetDraft(String(heightOffset))} />
      </label>
      <label className="roof-pitch-link" title="Trim supporting wall tops on this floor to the roof underside. Taller adjoining facades stay independent. This also works with house clipping turned off.">
        <input aria-label="Fit supporting walls to roof" type="checkbox" checked={roof.fitSupportingWalls === true}
          onChange={event => onChange({ fitSupportingWalls: event.target.checked })} />
        <span>Fit supporting walls to roof</span>
      </label>
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
      {roof.type !== 'flat' ? <>
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
      <label className="roof-pitch-field">
        <span>Overhang pitch (°)</span>
        <input
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
          type="checkbox"
          checked={roof.overhangPitchDegrees === undefined}
          onChange={(event) => onChange({
            overhangPitchDegrees: event.target.checked ? undefined : roof.pitchDegrees,
          })}
        />
        <span>Match roof pitch</span>
      </label>
      {roof.type === 'up-and-over' || roof.type === 'bay' ? (
        <>
          <label className="roof-pitch-field">
            <span>Soffit / fascia colour</span>
            <input
              type="color"
              value={roof.soffitColor ?? '#ffffff'}
              onChange={(event) => onChange({ soffitColor: event.target.value })}
            />
          </label>
          {(roof.type === 'up-and-over' ? ['ridgeStartChamfer', 'ridgeEndChamfer'] as const : []).map((field, index) => {
            const chamfer = roof[field]
            const setChamfer = (value: RoofEndChamfer | undefined) => onChange({ [field]: value })

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
                    <label className="roof-pitch-field">
                      <span>Setback (m)</span>
                      <input
                        aria-label={`Chamfer end ${index === 0 ? 'A' : 'B'} setback`}
                        type="number"
                        min="0.05"
                        step="0.05"
                        value={chamfer.distance}
                        onChange={(event) => {
                          const value = Number.parseFloat(event.target.value)
                          if (Number.isFinite(value)) setChamfer({
                            ...chamfer,
                            distance: Math.max(0.05, value),
                          })
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>
            )
          })}
        </>
      ) : null}
      </> : null}
    </>
  )
}
