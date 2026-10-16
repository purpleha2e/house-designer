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

## Geometry calculation cost

Direct CPU profiling of the current `colin_house_v2.json` wall-clipping input
found that vertical roof-cut closures dominated calculation time. The upper
floor had 425 input faces and eight roofs. Fitted roofs produced many overlapping
cutters; the closure algorithm compared their boundary planes again for every
wall-top section, including sections whose polygons had already been removed.

Boundary ownership is now resolved lazily once per boundary. Empty closures
stop immediately, and earlier cutters skip a comparison whose result cannot
affect ownership. Cutting order, tolerances and generated faces are unchanged.

Replaying the same captured worker inputs directly in Node (excluding browser
startup, worker loading, shaders and lighting) reduced the slow job from
18,121 ms to 1,217 ms with CPU profiling enabled, about 15 times faster. An
unprofiled confirmation took 912 ms. All six captured jobs retained identical
SHA-256 hashes of their complete serialized output, including face IDs,
vertices, UVs and material/picking ownership. These are local measurements of
the clipping stage, not total scene-loading times.

`tests/wallRoofClipPerformance.test.ts` exercises overlapping panels across 24
wall tops. It verifies identical output to a single cutter and bounds plane
evaluations instead of using a timing threshold. The original implementation
performed 766,656 evaluations; the optimized implementation performs 323,616,
below the test's 400,000 limit. Existing roof/wall clipping, gable and surface
partition regressions also pass.
