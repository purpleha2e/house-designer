# Roof undersides

Click a roof from below to select **Roof underside**, then apply a material in the material panel. This applies to the room-side underside of that roof structure, across its slopes. Exterior tiles, perimeter finishes and the underside of roof overhangs remain independent. Removing the underside override restores the exterior roof finish.

The selected underside panels show a translucent blue highlight, using the roof
creation colour. The highlight follows the clipped underside, is visible from
below, and replaces the orange whole-roof selection box while that underside is
selected. It is a selection overlay and does not change the assigned material.

The supporting wall footprint separates the interior underside from exterior
soffits. Overhangs outside that footprint use the roof's soffit colour, including
the narrow sloping strip beneath a gable-end overhang, and cannot inherit an
interior underside material.

Roof assignments use the existing `type: 'roof'` target, with optional `part: 'underside'`. Existing assignments without `part` retain their exterior meaning and serve as the underside default. Both assignments round-trip through project JSON and use separate selection keys.

The visible top still uses the resolved roof envelope. Undersides and perimeter edges are generated from the original structural faces and clipped against adjoining undersides. Extruding an already-cut top boundary created the small vertical tiled strip in Red House's vaulted room. Meeting the undersides at their actual thickness removes that strip without opening a gap.

Only an adjoining roof's supported footprint can trim the room-side underside. Its overhang must not notch the vaulted ceiling beyond the supporting wall. The Red House test samples both corners across that narrow strip and requires the vault's own plane to stay continuous; checking coverage from either roof alone missed the defect from higher viewpoints.

Validation: `tests/roofUnderside.test.ts` covers the Red House junction and all five roof types; `tests/roofMaterialAssignments.test.ts` covers independent replacement, removal and JSON persistence. `tests/browser/roofUndersideRegression.js` checks actual interior/exterior picking and painting in the Red House harness.
