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

1. Compare ridge heights in world coordinates, including floor elevation and
   height offset. The higher ridge continues through the junction. Heights within
   25 mm are treated as equal for connection priority; at a T, the incoming end
   terminates at the receiving ridge. Coincident panels have a deterministic
   owner, independent of array order.
2. Extend the lower or equal incoming gable towards the receiving ridge without
   changing its pitch, ridge height, or saved footprint. Never extend roof planes
   infinitely. A higher incoming roof retains its authored extent and consumes
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
   Close upper-wall cuts across their thickness, including vertical steps at
   footprint boundaries, preserving window voids, UVs, and material/picking references. Infill extends
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

## Regression coverage

`tests/roofJunctions.test.ts` covers T junctions, elevation priority, both end
settings, missing targets, bounded extensions, narrow intersections, rigid
transforms, array order, and isolated eaves. Wall tests cover exact clipping,
facade caps, sloping closures, opening voids, and save/load behaviour.

`tests/fixtures/roof-junctions` contains geometry-only snapshots of red_house_3
and Springfield_13 so continued modelling does not change the test inputs.
The browser harness at `/tests/browser/roofWallRegression.html` checks the current
editable houses; add `?springfield` or `?ground` for those views.
