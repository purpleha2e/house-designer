# Roof thickness

Every roof type has a **Roof thickness (m)** field when creating a roof and in
the selected roof's settings. Values range from 0.01 to 1 m; existing projects
default to the previous 0.04 m shell.

Thickness is measured vertically below the roof surface. Changing it keeps
the top surface and mounting height fixed while moving the underside. Shell
edges, soffits, wall infill, wall clipping, ceiling/slab cuts and overlapping roof
shells all use the selected thickness. At overlaps, each exposed panel retains
the thickness of its owning roof.

The browser check in `tests/browser/roofThicknessRegression.js` exercises the
actual thickness input and measures the top and shell geometry for all five
roof types. Run `checkRoofThicknessControls()` from that module while viewing
`/tests/browser/bayRoofRegression.html`.
