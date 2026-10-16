# Viewport responsiveness

Camera input takes priority over preparation. A cold load shows an instanced outline preview; subsequent updates render a retained copy of the last prepared scene. Preparation status does not intercept pointer events. The retained copy preserves transforms, material programs, group order and shadow maps. Resource leases defer disposal until its replacement is ready.

Navigation runs before display rendering. It ignores input older than 100 ms, discards elapsed time after a frame gap above 100 ms, caps an individual movement step at 50 ms, and resynchronizes mouse look after a gap. Key/button releases always clear input. Blur, hidden tabs and control disposal clear held keys.

Room volumes, roof/gable construction, wall clipping setup/cutting, finish resolution, wall buffer construction and wall selection groups run in cancellable workers. Completed geometry results wait for navigation to stop before starting a React transition; obsolete results are discarded. Lighting cache encoding/decoding runs in a worker. Reflection PMREM filtering uses a separate worker WebGL context; its output matches the previous filter exactly in the browser regression.

Scene scans, capture snapshots, skirting construction/clipping, shader submission, and uploads yield between short tasks. Shader preparation waits for both sides of transparent materials and includes shadow and postprocessing variants. Texture transfers are split into bounded regions; replacement volumes are uploaded into separate GPU textures and published together. Geometry buffers are prepared without issuing a GL draw. A timer cannot mark incomplete resources ready.

Display draws precede GI captures. Background capture pauses during navigation and the idle grace period; at most one capture draw is submitted per frame and one probe readback remains outstanding. GPU submission time does not measure all queued GPU work, so CPU deadlines alone are insufficient.

The display renderer and its WebGL context still live on the main thread. Individual driver calls and asset parsing therefore remain measurable work. Use production builds for release measurements, and do not interpret the scheduling safeguards as proof of zero long frames on every device. Development React additionally performs expensive scene-prop diagnostics.

## Reproducible checks

With Vite and the asset portal running:

```powershell
node tests/browser/viewportResponsiveness.mjs 5181 0 --resources
node tests/browser/viewportResponsiveness.mjs 5181 175 development --navigation
```

For production React, start the fixture server, then run the browser harness:

```powershell
node tests/browser/serveViewportProduction.mjs
node tests/browser/viewportResponsiveness.mjs 5184 175 production --navigation
```

The harness records long tasks, display gaps and CPU stacks. It checks normal camera movement, recovery after an injected 700 ms pause, continued drawing during a real roof edit, complete saved GI/reflections, and WebGL errors. Screenshots and profiles use `.tmp-viewport-*` paths. The resource check reads texture pixels back from the GPU and compares worker PMREM against the original filter.

Add `--max-edit-gap=50` to enforce a 50 ms maximum edit/navigation draw gap. Functional navigation passing alone does not satisfy this release budget. Keep the profile even on failure so the remaining foreground work can be identified.

## Current measured limits

The final production saved-house run (`prepared-walls`) passed navigation, recovery from the injected pause, complete saved lighting/reflections, edited-scene preparation and WebGL error checks. Its maximum edit/navigation draw gap was **58.1 ms**, so the explicit **50 ms release budget failed**. The preceding run measured 45.1 ms; this variation is why one passing run is insufficient.

Cold preparation still recorded a **404 ms** foreground task. The profile identifies first-use graphics-program initialization in the postprocessing path as a remaining source of blocking work. These changes remove the measured multi-second preparation freezes and camera catch-up, but do **not** establish a stall-free viewport. Further isolation of rendering/graphics initialization is required before making that claim.

The production build and focused geometry/scheduling/resource regressions pass. The wider suite checked during this work passed 819 of 824 tests; five house-fixture tests access a third floor absent from the current JSON fixtures. The user's saved house files were not rewritten to satisfy those tests.

Regenerate the lossless compressed RoomEnvironment asset after deliberately changing its source or filter settings:

```powershell
node tests/browser/viewportResponsiveness.mjs 5181 0 --bake-environment
```

The `.bin.gz` asset contains the original half-float cube-UV pixels; no runtime environment convolution or lossy image conversion is needed.
