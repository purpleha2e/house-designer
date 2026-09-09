import type { RoofStructure } from '../types'

export function RoofPitchFields({
  roof,
  onChange,
}: {
  roof: Pick<RoofStructure, 'type' | 'pitchDegrees' | 'overhangPitchDegrees' | 'soffitColor'>
  onChange: (updates: Partial<RoofStructure>) => void
}) {
  if (roof.type === 'flat') return null

  return (
    <>
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
      {roof.type === 'up-and-over' ? (
        <label className="roof-pitch-field">
          <span>Soffit / fascia colour</span>
          <input
            type="color"
            value={roof.soffitColor ?? '#ffffff'}
            onChange={(event) => onChange({ soffitColor: event.target.value })}
          />
        </label>
      ) : null}
    </>
  )
}
