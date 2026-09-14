import type { RoofEndChamfer, RoofStructure } from '../types'
import { getRoofThickness } from '../roofThickness'

const DEFAULT_CHAMFER_DISTANCE_METERS = 0.5

export function RoofPitchFields({
  roof,
  onChange,
}: {
  roof: Pick<RoofStructure, 'type' | 'thickness' | 'pitchDegrees' | 'overhangPitchDegrees' | 'soffitColor' | 'ridgeStartChamfer' | 'ridgeEndChamfer'>
  onChange: (updates: Partial<RoofStructure>) => void
}) {
  return (
    <>
      <label className="roof-pitch-field">
        <span>Roof thickness (m)</span>
        <input type="number" min="0.01" max="1" step="0.01" value={getRoofThickness(roof)}
          onChange={(event) => {
            const thickness = Number.parseFloat(event.target.value)
            if (Number.isFinite(thickness)) onChange({ thickness: getRoofThickness({ thickness }) })
          }} />
      </label>
      {roof.type !== 'flat' ? <>
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
