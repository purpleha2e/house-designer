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

Nearby-roof fading applies to exterior tiles, edges, soffits and exterior gable
faces only. Main roof and dormer linings, along with interior gable faces, keep
their opacity, depth writing and normal picking. The Render panel's Hide roofs
switch hides roof surfaces (including dormer caps and linings) while retaining
the dormer walls and windows. Hide roofs and Roofs only are mutually exclusive.
`checkRoofRenderOptions()` in `tests/browser/roofRenderOptionsRegression.js`
checks exterior fading, unchanged interiors, restoration and both switches.

When a loft uses a roof owned by a lower storey, selecting its underside keeps the loft as the active editing floor. The loft's visible level and local lights therefore stay active. The selected surface retains the roof owner's `floorId`, so painting still updates the correct roof. Exterior roof selection continues to select the owning storey.

The visible top still uses the resolved roof envelope. Undersides and perimeter edges are generated from the original structural faces and clipped against adjoining undersides. Extruding an already-cut top boundary created the small vertical tiled strip in Red House's vaulted room. Meeting the undersides at their actual thickness removes that strip without opening a gap.

Only an adjoining roof's supported footprint can trim the room-side underside. Its overhang must not notch the vaulted ceiling beyond the supporting wall. The Red House test samples both corners across that narrow strip and requires the vault's own plane to stay continuous; checking coverage from either roof alone missed the defect from higher viewpoints.

Validation: `tests/roofUnderside.test.ts` covers the Red House junction and all five roof types; `tests/roofMaterialAssignments.test.ts` covers independent replacement, removal and JSON persistence. `tests/browser/roofUndersideRegression.js` checks actual interior/exterior picking and painting in the Red House harness.

`tests/surfaceSelection.test.ts` covers loft editing context and material ownership. In `roofWallRegression.html?loft-test&edit-floor`, `checkLoftRoofSelectionLighting()` from `tests/browser/loftRoofSelectionLightingRegression.js` adds a loft with a point light and checks actual underside/floor clicks preserve the active floor, light power and light position.


Dormer interiors use the resolved supporting roof (including wall support extents),
with closed front gables and a valley-shaped aperture. The dormer roof and fascia
terminate at the host slope; the cheeks meet the same ceiling. A dormer attached
to a lower floor's roof uses the enclosed loft floor as its base and remains visible
while that loft is edited. Transverse internal knee walls receive derived full-height
recess openings; these do not modify saved walls and disappear with the dormer.
Without an intersecting internal wall, both the front apron and cheeks are clipped
at the roof lining. Wall intersection detection includes wall thickness and angled
segments, including walls whose centre line lies outside the dormer footprint.
The loft floor is found from the recess as well as its roof mounting point.
Dormer cheeks are clipped out of the loft cavity below the main roof underside.
Where a knee wall intersects the recess, full-height returns remain outside its
inner face; the wall fins on the room side are removed. The cut is a closed solid
and follows the dormer rotation and scale.
Both individual and perimeter wall caps respect openings reaching the wall top.
At each dormer valley, the two roof linings meet at their exact intersection.
The buried joint cap is omitted from the visible tiled shell: a clearance here
leaves a dark slit, while rendering the cap on the host lining causes z-fighting.
The interior regression samples both sides of the valley at sub-millimetre
distances across roof pitches and dormer depth scales.

`tests/dormerInterior.test.ts` covers the junction across roof pitches, attachment
movement, loft ownership and wall caps. In the browser fixture, run
`checkLoftDormerInterior()` from `tests/browser/loftDormerInteriorRegression.js` on
`roofWallRegression.html?loft-test` and `?loft-test&edit-floor` to check the gable,
ceiling and clear knee-wall recess.

`checkLiveDormerWallIntersections()` in the same browser module checks adding a
dormer to an existing scene, inserting a knee wall, thickness-only contact, and
moving the dormer away: openings must update and the original wall must return.

Dormer ceilings inherit the attached roof's underside material (including its
fallback to the roof finish). Interior wall faces and window reveals inherit the
room-facing finish of the intersecting internal wall. If several walls intersect,
the wall with the longest overlap supplies the finish. With no intersection,
the context panel exposes an interior wall material choice, saved in the model's
material overrides. That choice is retained while an intersecting wall takes
precedence, and resumes when the dormer moves away. Exterior faces keep their
own finish. `tests/dormerMaterials.test.ts` checks inheritance and persistence;
`checkDormerMaterials()` in `tests/browser/dormerMaterialsRegression.js` checks
live material changes and the dropdown using `?loft-test&dormer-materials`, with
or without `&edit-floor`.

Selected dormers expose width and front wall height in metres, measured above the
roof mounting point up to the gable. These dimensions rebuild the window opening,
walls, roof valley and host aperture; the chosen window retains its proportions.
The exterior wall finish is independently selectable and saved with the model.
Dormer front and side walls use the shared 300 mm external-wall thickness and
the normal external-wall material when no exterior override is selected. Inside
finishes remain separate. Roof overhangs, soffits and window reveals account for
the full wall thickness, and the front wall embeds through the host roof skin.
Dormer windows share normal windows' 20 mm exterior frame inset. Placement uses
the imported frame bounds and the normal reveal-depth limit, with scale accounted
for so resizing a dormer keeps that inset in world metres. The fallback frame
uses the same inset. `checkDormerWindowReveals()` measures both saved window styles
and scaled dormers in the browser.
Dormer tile UVs use the main pitched roof convention (along the ridge and distance
down the slope). Boxed eaves have the main roof's 160 mm fascia and soffit colour,
with a continuous soffit under the front overhang. `checkDormerExterior()` in the
material browser regression verifies the dimension controls and exterior finish.

For an explicit wall height, windows fit against the pitched gable lining at
both top corners, retaining their aspect ratio. A low eave therefore does not
force the whole window below it. Floor ownership uses the dormer's ceiling
height, so a sill below the loft slab does not move the dormer to the storey
below. Knee-wall intersections use the full pentagonal roof aperture, including
its triangular rear; lower cheek returns can continue behind the side valley
to meet that wall. `checkWideLowDormer()` covers the saved 2.25 m by 0.6 m case
in full-house and loft-edit views. An intersecting eaves wall on the loft is also
cut from the recess, while the supporting facade on the roof's own storey is
preserved; material inheritance still comes from the internal knee wall.
When the loft boundary is an external eaves wall with no internal knee wall,
its room-facing surface also defines full-height dormer returns. Cutting that
wall must retain the front apron and side walls down to the loft floor. When
both wall types intersect, the internal knee wall remains the return boundary.
`checkExternalWallDormer()` verifies the lower enclosure in `?red-house-5`.
Enclosed dormer recesses also extend the floor to the front and side walls.
The extension fills only gaps in the rendered room floors (including roof
cutouts), preserves stair openings and uses the adjoining room's floor finish
and selection target. Existing floor areas and overlapping dormer patches are
subtracted to avoid coplanar surfaces. Patches are derived from the roof attachment
and room boundary, so moving or deleting the dormer updates them without changing
saved rooms. They remain visible when editing the loft or the roof-owning storey.
Derived dormer openings do not receive a separate doorway threshold: the dormer
floor already covers that area. At wall joins, portions of coplanar dormer
return end caps buried in the remaining host wall are removed.
The exposed portion inside the opening remains closed. Host wall thickness,
rotation and authored openings determine the trimming solids; no depth bias is
used to conceal overlapping surfaces. The Red House browser regression checks
single-surface ownership at both side joins and across the floor threshold.

Existing dormers support the 3D Move tool. Local X moves across the roof and
local Z moves up/down the slope; elevation follows the attached roof face.
Release commits the updated roof attachment, rebuilding roof and wall openings.
The complete valley must remain on the same face, and invalid drags restore the
last valid position. Size and materials are preserved. `checkDormerMove()` checks
the actual transform-control callbacks, persistence and edge rejection in both
full-house and loft-edit views.
