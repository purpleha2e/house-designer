# Wall / roof clipping responsiveness

Profiling `red_house_3.json` reproduced a multi-second main-thread stall in
`buildRoofCutCaps` and `buildVerticalRoofCutCaps`. Downward wall boundaries were
checked repeatedly against caps, with footprint planes rebuilt inside nested
loops. This work ran synchronously while React rendered the walls.

Clipping now runs in a dedicated module worker for each floor. Affine clipping
planes are encoded once, retaining shared plane identities. Completed walls
remain visible during replacement; cancellation terminates obsolete jobs, and
late results cannot overwrite newer edits. Worker failures retain the previous
geometry and report an error instead of repeating heavy work on the UI thread.

Disjoint cutters are rejected before they can subdivide unrelated polygons.
Downward boundary planes are built once per clipping pass. Geometric inputs
remain stable across selection/status updates, and floor preparation depends on
wall geometry rather than every change to furniture, lights or roofs.

Verification:

- Unit tests cover worker transport, cap/window geometry, cancellation, stale
  replies, failure handling, and unrelated cutters.
- Open `/tests/browser/roofWallRegression.html?materials` and wait for loading.
  Run `await (await import('/tests/browser/geometryResponsiveness.js')).checkGeometryResponsiveness()`
  in the browser console. It makes two roof edits, changes selection repeatedly,
  checks timer responsiveness, and verifies floor preparation was not restarted.
- On the development machine, that edit sequence completed in 2.9 seconds with
  background clipping, a maximum timer gap of 276ms, and no reported main-thread
  stalls. This is a measured regression check, not a guarantee for every scene or
  graphics driver; initial shader compilation can still cause shorter pauses.
