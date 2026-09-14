Walls abutted by a roof from a lower floor keep their solid geometry. Their exterior material surfaces are divided at the roof contact profile, so disconnected exposed areas can be selected and finished independently.

Normal clicks select a contiguous panel or roof region. Shift-click selects the adjoining exposed exterior surfaces, including corner returns and other exposed roof regions; wall regions behind roofs are excluded.

The division uses the structural roof profile through adjoining roof shells, avoiding a narrow selection bridge beneath the upper eaves. The opposite wall side remains unchanged. Existing facade finishes are inherited; assignments to a new roof region cannot fall back onto neighbouring regions. UV coordinates are interpolated across each division.

Surface division runs in the wall clipping worker. `wallRoofSurfacePartitions.test.ts` covers the saved `roof_tests.json` junction, area preservation, UVs, worker transport and roof reordering. In `tests/browser/roofWallRegression.html?roof-tests`, run `checkRoofMaterialRegions` from `roofMaterialRegionsRegression.js` to check clicks, shift-selection and painting one exposed region independently.

Contact detection is independent of the whole-wall abutment exemption used for geometry clipping. This also handles roofs meeting only part of a longer facade and slightly angled Bay mounting edges in `red_house_3.json`. Room surface faces retain their existing selections. Run `checkRedHouseRoofMaterialRegions` on the same harness with `?materials` to check the saved house's main roof and Bay contacts.
