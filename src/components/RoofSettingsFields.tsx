import { useId, useState, type ReactNode } from 'react'
import type { FloorLevel, RoofStructure } from '../types'
import type { BuildingRoof } from '../roofBuildingGeometry'
import { RoofPitchFields } from './RoofPitchFields'
import { RoofRidgeFields } from './RoofRidgeFields'
import { RoofAlignmentFields } from './RoofAlignmentFields'
import { RoofConnectionFields } from './RoofConnectionFields'
import { ROOF_TYPE_LABELS } from '../roofLabels'

export function RoofSettingsFields({ roof, floors, floorId, candidate, onChange, creating = false,
  shapeControls, overhangControls, actions, bayRidgeMaxLength }: {
  roof: RoofStructure; floors: FloorLevel[]; floorId: string; candidate?: BuildingRoof
  onChange: (updates: Partial<RoofStructure>) => void; creating?: boolean
  shapeControls?: ReactNode; overhangControls?: ReactNode; actions?: ReactNode; bayRidgeMaxLength?: number
}) {
  const [tab, setTab] = useState<'shape' | 'height' | 'advanced'>('shape')
  const id = useId()
  const floor = floors.find(f => f.id === floorId)
  const index = (floor?.roofs ?? []).findIndex(r => r.id === roof.id)
  const props = { roof, onChange, chamferGeometry: candidate?.resolved, bayRidgeMaxLength,
    alignedHeightOffset: candidate?.heightAlignmentStatus?.state === 'linked' && roof.heightAlignment?.mode === 'slope'
      ? candidate.roof.heightOffset ?? 0 : undefined }
  const ridgeProps = { roof, onChange, floors, floorId, candidate }
  const warnings = [candidate?.heightAlignmentStatus, candidate?.ridgeHeightLink]
    .some(status => status?.state === 'unresolved') || candidate?.resolved.connections.some(c => c.state === 'unresolved')
  return <>
    <header className="roof-settings-header">
      <h2>{creating ? 'New roof' : `Roof ${index + 1} · ${ROOF_TYPE_LABELS[roof.type]}`}</h2>
      <p>{creating ? 'Choose a shape, then select its supporting points on the plan.'
        : `${floor?.name ?? ''} · ${roof.type === 'flat' ? 'Flat roof' : `${roof.pitchDegrees}° pitch`}`}</p>
    </header>
    <div className="roof-settings-tabs" role="tablist" aria-label="Roof settings sections">
      {([['shape', 'Shape'], ['height', 'Height & joins'], ['advanced', 'Advanced']] as const).map(([value, label]) =>
        <button type="button" key={value} role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}`}
          aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const tabs = ['shape', 'height', 'advanced'] as const
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
              : (tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : 2)) % 3
            setTab(tabs[next])
            document.getElementById(`${id}-${tabs[next]}-tab`)?.focus()
          }}>{label}</button>)}
    </div>
    {warnings && tab !== 'height' && <button className="roof-settings-warning" type="button" onClick={() => setTab('height')}>
      A roof connection needs attention. Open Height &amp; joins.</button>}
    <div className="roof-settings-body">
      <section role="tabpanel" id={`${id}-shape`} aria-labelledby={`${id}-shape-tab`} hidden={tab !== 'shape'}>
        {shapeControls}
        <RoofPitchFields {...props} section="shape" />
        <RoofRidgeFields {...ridgeProps} section="shape" />
        <div className="roof-settings-group">
          <h3>Overhangs (m)</h3>
          <small>Distance the roof extends beyond the walls.</small>
          {overhangControls ?? <div className="roof-overhang-grid">
            {(roof.type === 'bay' ? ['overhangSide'] : roof.type === 'up-and-over'
              ? ['overhangEnd', 'overhangSideNegative', 'overhangSidePositive'] : ['overhangEnd', 'overhangSide']).map(field => {
              const key = field as 'overhangEnd' | 'overhangSide' | 'overhangSideNegative' | 'overhangSidePositive'
              return <label key={key}><span>{key === 'overhangEnd' ? 'Ends (m)' : key === 'overhangSideNegative' ? 'Side 1 (m)'
                : key === 'overhangSidePositive' ? 'Side 2 (m)' : 'Eaves (m)'}</span>
                <input aria-label={`Roof ${key}`} type="number" min="0" step="0.05"
                  value={roof[key] ?? roof.overhangSide ?? 0}
                  onChange={event => { const value = Number.parseFloat(event.target.value)
                    if (Number.isFinite(value)) onChange({ [key]: Math.max(0, value) }) }} /></label>
            })}
          </div>}
        </div>
        {roof.type === 'up-and-over' && <details className="roof-settings-group" open={Boolean(roof.ridgeStartChamfer || roof.ridgeEndChamfer)}>
          <summary>Chamfered ends</summary>
          <small>Replace a gable tip with a sloping face.</small>
          <RoofPitchFields {...props} section="chamfer" />
        </details>}
        {creating && <small className="roof-placement-help">{roof.type === 'bay'
          ? 'Select the two points against the wall first, then the outer bay corners.'
          : 'Select corners at the wall tops. Blue guides help align points; Ctrl allows free placement.'}</small>}
      </section>
      <section role="tabpanel" id={`${id}-height`} aria-labelledby={`${id}-height-tab`} hidden={tab !== 'height'}>
        <div className="roof-settings-group">
          <h3>Roof height</h3>
          <small>{roof.asymmetricSides ? 'Choose the ridge height, then match an eave if needed.'
            : roof.heightAlignment ? 'Height follows the matching roof.' : (roof.heightOffset ?? 0) !== 0
              ? `This roof is ${(roof.heightOffset ?? 0) < 0 ? 'lowered' : 'raised'} by ${Math.round(Math.abs(roof.heightOffset ?? 0) * 1000)} mm. Adjust it in Advanced.`
              : 'This roof sits on the wall tops. Use matching below to join another roof.'}</small>
          <RoofRidgeFields {...ridgeProps} section="height" />
          {!creating && <RoofAlignmentFields {...ridgeProps} />}
          {creating && <small>After creating the roof, select it to connect or align it with another roof.</small>}
        </div>
        <div className="roof-settings-group">
          <h3>Supporting walls</h3>
          <RoofPitchFields {...props} section="walls" />
          <small>Use this when an eave drops below the wall tops.</small>
        </div>
        {!creating && roof.type === 'up-and-over' && <details className="roof-settings-group"
          open={roof.ridgeStart?.mode === 'join' || roof.ridgeEnd?.mode === 'join'}>
          <summary>Gable connections</summary>
          <RoofConnectionFields {...ridgeProps} resolvedRoof={candidate?.resolved} />
        </details>}
      </section>
      <section role="tabpanel" id={`${id}-advanced`} aria-labelledby={`${id}-advanced-tab`} hidden={tab !== 'advanced'}>
        <small>Fine adjustments and construction details. Start with Shape and Height &amp; joins.</small>
        <RoofPitchFields {...props} section="advanced" />
        <RoofRidgeFields {...ridgeProps} section="advanced" />
      </section>
    </div>
    {actions}
  </>
}
