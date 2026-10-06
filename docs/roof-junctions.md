# Roof junctions

Select a gable roof to configure ends **A** and **B** independently. The labels
follow the roof when it rotates. Dashed lines show the resolved panels in plan.

- **Automatic** joins a single nearby gable roof whose ridge crosses this ridge's
  direction. Nearby means overlapping or within 350 mm of the support end.
- **Exposed gable** keeps the authored end and its overhang; it does not extend.
  Roof surfaces that are already inside another roof are still hidden.
- **Join roof…** stores the selected roof's ID, including targets on another
  floor. It can reach a more distant target. Moving or deleting that target
  preserves the setting and reports an unresolved connection if it cannot join.
  Ambiguous automatic connections also require a target choice.

## Geometry rules

The 3D renderer constructs a closed roof assembly in `roofAssembly.ts` before
creating any material meshes. Tile skins and boxed eaves are convex cells;
wall abutments, room/slab voids and joined-eave cuts operate on those cells and
create closure faces. Neighbouring roofs on the same storey share an exterior
boundary: internal cell faces are removed and boundary edges are conformed
before triangulation. Faces retain their roof and finish ownership for painting
and selection. A chamfer that reaches an end overhang receives a boxed end eave
as well as the side eaves. Coplanar tiles use a shared world texture frame.
Nearby gable eaves on the same storey share the lowest existing tile-edge
height when both their plan gap and their height difference are within one foot
(304.8 mm). Higher overhangs extend down their original roof planes to that
level, including chamfer ends. The extension is also limited to one foot.
Ridge positions, supporting walls and pitches stay fixed; the derived overhang
reach can increase. Chamfer setbacks increase with their end extension so the
chamfer plane stays fixed. Saved dimensions are unchanged. These derived
extents are resolved before roof joins, wall clipping and finishing geometry.
The whole group's height range must fit within the tolerance, so a chain of
near matches cannot pull an eave farther than a foot. Flat eave bases also
share the lowest existing soffit level, allowing for different roof thicknesses.
Sloping soffits, cut faces, other storeys and larger differences remain separate.
At a flush connection, the adjoining roof can support a retained overhang on
the same plane (within 1 mm), even when it owns the interior panel. Visibility
is resolved for all roofs before that support check. Where a tile-shell cut
and a fascia share an outer plane, the fascia owns the overlapping finish.
Shared support must also meet the individual overhang at the same wall-line
height. A higher joined panel cannot preserve an isolated lower tile/fascia
fragment merely because their plan intervals overlap.
Touching, joined roofs whose parallel tile surfaces differ by no more than
1 mm are rebuilt against common finishing planes in `roofSeamWelding.ts`.
Their skins, undersides and fascia then meet exactly, without changing saved
mount heights or pitches. Unjoined roofs and deliberate height steps retain
their geometry. `tests/roofSeamWelding.test.ts` covers that tolerance boundary;
the saved chamfer regression also checks exact shared planes and continuous fascia.

This replaces independent mesh clipping in `HipRoofMesh`. The junction resolver
still supplies the design envelope, and wall/gable fitting retains its existing
rules. A closed roof assembly does not move mount points or override an explicit
choice to disable wall fitting or house clipping. In particular, a wall cap
above a misplaced or deliberately lowered passive roof remains wall geometry.

`tests/roofAssembly.test.ts` checks two incident faces at every assembly edge,
closed Boolean cuts, internal-face removal, stable ownership, aligned tile UVs,
the long chamfer fascia in `roofAssemblyRegression.json`, and the Red House and
Springfield room/slab cases. These checks run on assembled polygons before the
renderer splits them by material.

1. Compare ridge heights in world coordinates, including floor elevation and
   height offset. The higher ridge continues through the junction. Heights within
   25 mm are treated as equal for connection priority; at a T, the incoming end
   terminates at the receiving ridge. Coincident panels have a deterministic
   owner, independent of array order.
2. Automatic connections extend the lower or equal incoming gable towards the receiving ridge without
   changing its pitch, ridge height, or saved footprint. Never extend roof planes
   infinitely. An explicit join also extends a higher incoming ridge. It can
   join a target with **Clip house geometry** turned off. Joined roofs trim each
   other's overlapping slopes: the locally higher surface remains visible.
   This applies only to that pair and does not grant either roof permission to
   cut unrelated roofs, walls or slabs. A roof can therefore stop against the
   receiving gable while still cutting the receiving slope at their side junction.
   Generated extensions stay inside the receiver's supported footprint, so a
   wider branch cannot leave tile strips beyond the receiving gable. Original
   roof coverage beside that gable remains intact.
   A higher automatically connected roof retains its authored extent and consumes
   the lower roof where they overlap.
3. Compute valleys from the actual bounded panel intersections. Remove the
   portions inside another roof's supported building region, preserving the
   exposed envelope. An overhang has air beneath it: outside that building
   region, remove only actual roof-shell intersections. A lower lean-to can
   therefore meet a facade beneath an upper gable's overhang. The receiving ridge
   bounds an incoming connection so it cannot emerge on the far slope.
4. A roof abuts the outside face of an adjoining facade. A connected roof may
   pass above that wall's top to reach the receiving roof, while abutting the
   wall below it. A roof below or above the entire wall does not create an
   abutment merely because their plan outlines touch.
5. Keep **original coverage** separate from **connection extensions**. Only the
   original coverage can trim upper-floor walls. Within that region, use the
   resolved envelope's underside; hidden lower panels cannot erase wall tops.
   Vertically separated overhangs retain separate wall coverage. Adjoining
   facades remain protected across openings and wall joins.
6. Generate tiles, shell edges, eaves, and gable infill from the resolved panels.
   An overhang requires an exposed supporting panel: no isolated fascia strips
   in front of a winning gable. Connected branches stop below the receiving
   gable's end overhang rather than carrying low eaves beyond its facade.
   Close upper-wall cuts across their thickness, including steps at footprint
   boundaries, preserving window voids, UVs, and material/picking references.
   Joined-end infill also stops beneath the receiver's eave,
   including a passive receiver, so exposed gable caps cannot protrude beside it.
   At a joined gable, infill follows the combined underside inside the roofs'
   support footprints. The receiving gable owns its facade plane; an incoming
   wall cannot grow a high brick return beneath the receiving overhang.
   Where original incoming tiles survive outside that support, retain their
   low wall infill up to their own underside rather than leaving a hole.
   This also closes the lower corner where the incoming slope cuts the gable.
   Unequal joined eaves preserve original tiles beneath a raised gable overhang
   so the neighbouring wall cap is not exposed. At an asymmetric side, the
   receiving pitch continues locally down to the incoming roof, bounded by
   that roof's authored footprint. Fascia follows this connection and is
   removed inside the other roof. Supporting brickwork closes beneath it.
   Tile orientation uses the whole panel normal, including when junctions
   insert collinear boundary points into a chamfer face.
   Unconnected ends remain independent. Infill extends
   walls only to resolved roofs on their own storey, so a lower lean-to's end
   walls cannot grow up to an unrelated upstairs gable. Horizontal room ceilings
   are cut where they would rise through the resolved roof underside, including
   ceilings on an upper storey enclosed by a lower storey's roof. Hidden lower
   panels and connection extensions cannot erase slabs inside the receiving
   building. Separate exposed overhangs retain their own cutting envelope. Inter-storey slabs use
   their top elevation for the same test, so their full thickness and edges remain
   inside the visible roof shell, including beneath overhangs.

The automatic rules deliberately leave ambiguous relationships unresolved.
Explicit end connections supply intent where geometry alone cannot determine it;
they do not grant permission to remove the receiving building's walls.

## Roof height

**Vertical offset (m)** moves the whole roof relative to its floor's normal
wall-top height. Negative values lower it, positive values raise it, and zero
restores the normal height. Pitch and plan dimensions remain unchanged.
The offset is available during placement and when editing an existing roof.

Enable **Fit supporting walls to roof** when lowering a roof onto its walls.
This trims and caps the contained external wall tops on that roof's floor.
It leaves taller walls, facades continuing beyond the roof, and other floors
independent. It works with **Clip house geometry** turned off and preserves
authored wall heights, endpoints, openings and finishes. Turning it off restores
the authored walls. Fitting trims existing walls; raising a roof does not extend
their authored heights.
Fitting also trims that floor's horizontal room ceiling beneath the roof.
Shared perimeter caps are cut within the fitted wall thickness even when an
adjoining wall owns the combined cap. Other floors and slabs retain their
separate clipping rules.

## Asymmetric gable roofs

For an **Up and over** roof, enable **Asymmetric sides**. **Ridge offset (m)**
moves the ridge sideways while keeping its height fixed. Positive moves towards
Side 2, negative towards Side 1; the sides are labelled on the selected plan.
**Mount at wall height** defaults to the shorter side. That side stays at its
support height (including the vertical offset), and its pitch adjusts to meet
the ridge. The other side retains the selected pitch and can reach a lower eave.
Choose **Side 1** or **Side 2** to anchor a particular side. **Free eave heights**
retains equal pitches and allows both eaves to move relative to the supports.
Existing asymmetric roofs without a saved choice use the automatic mounted side.
The controls show each eave's height above the floor and both effective pitches.
Overhangs follow each side's actual slope unless an explicit overhang pitch is
set. Matching another roof's ridge height does not change the overhang pitch.
Adjoining roofs with different pitches can therefore have different outer eave
heights even when their wall-top heights and overhang widths match. Set an
explicit overhang pitch when a pitch break is intended. Tile spacing follows
the resulting surface through any explicit pitch break.
Chamfered ends carry their lowered profile through the fascia and soffit too.
The roof panel groups its controls into **Shape** (type,
pitch, overhangs and chamfered ends), **Height & joins** (ridge height, matching,
wall fitting and gable connections) and **Advanced** (offsets, clipping,
overhang pitch and finishes). New roofs start on Shape. Matching heights appear
as a short readout; their precise adjustments remain in Advanced.
Use **Align with another roof** in Height & joins to keep adjoining geometry aligned without
calculating offsets. **Match adjoining slope** moves the selected roof vertically
to continue a nearby roof plane of the same pitch and direction. Select a target;
a joined end's target is selected automatically. **Match side 1/2 eave** shifts
an asymmetric ridge sideways to match the nearest target eave while retaining
the ridge height and both pitches. It selects free eave heights automatically.
The calculated offset is read-only while linked. Returning to **Manual settings**
retains the current result. Links follow target edits and survive save/load;
missing, circular or incompatible targets report a message and retain manual
settings. Height alignment preserves each roof's existing clipping and joins.
For a chamfer that should end level with its higher side eave, enable **Match
higher side eave** to derive the setback from the angle, ridge and eave heights.
Turn it off to enter a deeper setback that lowers the walls.
Chamfer setbacks are limited only by the remaining roof length. A deeper
chamfer lowers the eave while retaining its angle and the main roof pitches.
With **Fit supporting walls to roof** enabled, the walls and their caps follow
that lowered underside. Opposing chamfers may meet without overlapping. The
settings show the calculated maximum and effective setback. Oversized saved
values are limited during profile construction without rewriting the saved project.

Choose **Manual height** and enter the ridge height **Above wall tops (m)**,
or use **Match Floor … · Roof …** to keep its ridge at another roof's highest
point. A height link follows changes to the target roof, including across floors.
Unlinking retains the currently matched height. Missing targets and circular
links report a warning and use the saved manual height.

Enable **Fit supporting walls to roof** to trim the lower side's wall without
changing its saved height. Where the other eave is raised, roof-owned infill
continues the actual supporting wall up to the underside, including chamfers.
It preserves the wall's facade plane and does not invent walls across unsupported
spans. Gable infill follows the offset peak. End connections
remain independent: matching heights does not itself join roof panels; choose
**Join** on end A or B to join the adjoining roof. These controls are available
during creation and when editing, with live plan and 3D previews.

With a manual ridge height, the vertical offset still translates the whole roof.
A linked ridge stays anchored to its target's world height instead.

## Regression coverage

Side abutments stop at the facade's ends, including its corner thickness, so a
lower slope can meet another roof beyond the wall. Collinear facade sections
share a span across openings. Ridge-end abutments still trim the full incoming
overhang. Once a roof abuts a storey's actual walls, that storey's rectangular
roof support cannot cut another notch under its overhang; intersecting roof
shells still clip normally.

The rear gable/bay regression in `tests/roofBuildingGeometry.test.ts` covers both
the gap beyond the wall and the notch before the wall. Run
`checkRearRoofGap()` from `tests/browser/rearRoofGapRegression.js` on the material
harness to verify the rendered roof coverage and saved brick finish. Additional
roof contacts inherit a painted wall region when all its existing boundary
conditions still match.

`tests/roofJunctions.test.ts` covers T junctions, elevation priority, both end
settings, missing targets, bounded extensions, narrow intersections, rigid
transforms, array order, and isolated eaves. Wall tests cover exact clipping,
facade caps, sloping closures, opening voids, and save/load behaviour.

`tests/asymmetricRoof.test.ts` covers unequal eaves, ridge offsets, chamfers,
continuous tile distances, height-link chains and failure fallbacks, offset
ridge joins, dormer side selection and save/load. `tests/roofHeight.test.ts`
checks closure of fitted walls and gables beneath an asymmetric roof. Browser
checks in `roofHeightRegression.mjs` and `bayRoofPlacementRegression.mjs` cover
editing and creation with live 2D and 3D changes.

`asymmetricRoofJunctionRegression.mjs` checks the saved stepped roof contact:
the generated tile patch and exposed infill cap are absent, the original
coverage remains, and the brick gable and facade share one boundary.
Add `--finishing` to check the lowered saved roof: the wall cap closes beneath
the tiles, the raised eave has continuous brick below it, and the horizontal ceiling no longer protrudes. The chamfer fascia
and shared perimeter cap also have geometry regressions.
Use `--anchored` to check automatic mounting of the same saved roof: the actual
rendered edge meets the 5.10 m mount, the 6.87 m shared ridge remains, the incoming
eave is retained, and no joining extension is generated. The historical free-eave
fixtures explicitly select `mountSide: "free"` to preserve that coverage.

`tests/fixtures/roof-junctions` contains geometry-only snapshots of red_house_3
and Springfield_13 so continued modelling does not change the test inputs.
The browser harness at `/tests/browser/roofWallRegression.html` checks the current
editable houses; add `?springfield` or `?ground` for those views.
