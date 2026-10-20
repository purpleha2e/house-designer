# Viewport responsiveness

Responsiveness applies to every editor operation, including placement, dragging,
opening changes and finishes. Background completion time and UI response time
are separate acceptance checks: an edit appearing eventually does not excuse a
blocked interface. Keep the prepared scene navigable, supersede obsolete work,
and measure long tasks as well as actual display draws.

Window and door placement uses an unlit blue size guide. The detailed asset is
loaded when placed, and the guide remains live while the building display is
retained. Guides (including their descendants) are excluded from lighting,
shader and resource scans. Valid wall placement uses the wall planes directly
without raycasting furniture.

Once the scene's shader features are prepared, geometry and material edits only
upload changed buffers and textures. They retain the compiled shader snapshot
instead of cloning the furnished house again. Asset IDs do not invalidate shader
programs; actual material features still do. Lighting continues to refine after
the updated geometry and finish can be displayed.

Worker readiness subscriptions live outside the expensive scene component.
Both React roots (the editor and Canvas) defer scene reconciliation; scene
contexts travel with that deferred update. Unchanged building elements retain
their identities across progress notifications. The display gate reads worker
state immediately rather than relying on deferred React status.

Wall workers transfer packed vertex buffers directly into geometry attributes.
Wall-face messages are split into bounded chunks in both directions; merely
moving a calculation into a worker does not eliminate structured-clone stalls.
Storey source faces, inter-storey assemblies and lighting cache validation also
run in workers. Roof ridge links reuse their structural inputs across opening
and furniture edits. Building retained display copies yields between short tasks
and releases partial resource leases when an edit supersedes the copy.
Lighting helpers exchange their visibility tree and lamp results over message
ports connected to the coordinator worker. The UI owns the helpers for immediate
cancellation but does not relay their large geometry payloads.

Regression: `node tests/browser/windowPlacementPerformance.mjs --preview-only --edits`
with Vite on port 5180 and the prepared Colin viewer assets. This checks actual
display draws for the placement guide, moved openings and a wall material change.
For production, use `--production` with the fixture server on 5184 and the asset
portal running. `--max-ui-stall-ms=100` enforces a UI heartbeat budget;
`--operations` additionally checks door insertion and furniture movement.
`--profile --trace` captures diagnostic stacks and Chrome trace
events. Measure release latency without those profiling flags or competing builds.

Camera input takes priority over preparation. A cold load shows an instanced outline preview; subsequent updates render a retained copy of the last prepared scene. Preparation status does not intercept pointer events. The retained copy preserves transforms, material programs, group order and shadow maps. Resource leases defer disposal until its replacement is ready.

The startup PBR view preserves glass opacity and texture cutouts. Physical
transmission temporarily uses alpha glass until full rendering is prepared.
Static startup draws are throttled while camera movement remains live. The
activity text reports the actual shader stage, completed batches and elapsed
time instead of reporting a generic GI wait throughout shader compilation.

Navigation runs before display rendering. It ignores input older than 100 ms, discards elapsed time after a frame gap above 100 ms, caps an individual movement step at 50 ms, and resynchronizes mouse look after a gap. Key/button releases always clear input. Blur, hidden tabs and control disposal clear held keys.

Room volumes, roof/gable construction, wall clipping setup/cutting, finish resolution, wall buffer construction and wall selection groups run in cancellable workers. Completed geometry results wait for navigation to stop before starting a React transition; obsolete results are discarded. Lighting cache encoding/decoding runs in a worker. Reflection PMREM filtering uses a separate worker WebGL context; its output matches the previous filter exactly in the browser regression.

Scene scans, capture snapshots, skirting construction/clipping, shader submission, and uploads yield between short tasks. Shader preparation waits for both sides of transparent materials and includes shadow and postprocessing variants. Texture transfers are split into bounded regions; replacement volumes are uploaded into separate GPU textures and published together. Geometry buffers are prepared without issuing a GL draw. A timer cannot mark incomplete resources ready.

Finish changes reuse already loaded maps immediately rather than dropping to an
intermediate untextured material while React commits their state. New shader features prepare
only the changed objects and their fade/shadow variants; compilation skips
variants owned by earlier snapshots. Those snapshots remain alive until renderer
settings change or the viewport unmounts, so switching back can reuse programs.
Changed buffers and textures are still uploaded before the new display is used.
This reduces redundant preparation; genuinely new shaders still have a driver
compilation cost. The expanded browser check adds `--first-use-material` to
exercise new variants and verify that restoring a loaded finish submits no new
shader batches. `--gable-materials` checks matching gable/wall receiver settings.

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

The stairwell follow-up removed the whole-house transform update and selection
scan from every startup/retained display frame. Selection membership is indexed
on hierarchy or selection changes; frame updates touch the selected meshes.
Startup copies yield between meshes, retain instancing, and prepare programs and
buffers before publishing the first PBR draw. A navigable outline preview remains
available during this work. Cancellation releases partially retained resources.

Two 100-second development CPU profiles recorded 608 then 295 long tasks, with
the largest falling from 3,589 to 661 ms. These profiles include instrumentation
overhead and different startup phases; they are diagnostic, not a release budget.
A separate unprofiled production cold run still recorded an **889 ms long task**
and **906 ms UI heartbeat gap**. Graphics initialization, image uploads and
startup application work remain blockers. The run ended during full shader
preparation, so it does not certify a completed GI bake or steady-state navigation.
Do not describe this as a complete move off the UI thread or a stall-free editor.
A separate production input check passed real camera movement during both the
outline preview and lit preparation, with 73 and 25 display draws during the
1.2-second holds. Maximum gaps were 18 and 119 ms respectively; the lit stage
still exceeds a 100 ms budget. These checks did not wait for GI completion.

`giPipelinePerformance.mjs` now records UI long tasks and timer heartbeat gaps
alongside worker/capture timings. Add `--profile-ui` to save a Chrome CPU profile,
or `--max-ui-stall-ms=100` to enforce an explicit responsiveness budget. Measure
release latency separately from CPU profiling and competing builds.

The material follow-up production run (`--preview-only --edits
--first-use-material --gable-materials --max-ui-stall-ms=100`) measured a loaded
wall finish at **1.43 s**, a new image-based-lighting shader combination at
**13.02 s**, and restoring the loaded finish at **1.36 s**. UI heartbeat gaps
were 45, 93 and 86 ms respectively. The new finish submitted five prototypes;
restoring the old finish submitted none. Matching gable/wall material checks and
transparent startup glass passed. These are software-rendered Chrome results,
not a guaranteed latency budget. Cold runs vary substantially; another
experimental run exceeded both 20 seconds for first use and 100 ms for input.
That texture-retention experiment was reverted. New driver compilation and
occasional foreground stalls remain unresolved; do not describe editing as
instant or universally stall-free.

### Earlier cold baseline

The expanded cold production test verifies transparent startup glass and actual
display draws after moving three windows, changing a finish, adding a door and
moving furniture. Its latest run still **failed the 100 ms UI heartbeat budget**:

| Operation | Visible update | Largest UI heartbeat gap |
| --- | ---: | ---: |
| Window placement guide | 0.53 s | Pointer handlers 1–8 ms |
| Move three windows | 9.44 s | 164 ms |
| Change wall finish | 20.46 s | 186 ms |
| Add a door | 9.50 s | 283 ms |
| Move furniture | 1.23 s | 313 ms |

Cold full shader preparation took 142 seconds in that run; the initial view was
available earlier with transparent glass. An earlier run measured 55 seconds,
2.83 seconds for the window move and 1.35 seconds for the finish. Do not treat
the faster run as a guarantee: cold graphics compilation and foreground display
draws remain significant, and universal stall-free editing has not been achieved.
These results are saved in `node_modules/.cache/startup-result.json`,
`window-placement-result.json` and `scene-edit-result.json` by the regression.

### Earlier navigation benchmark

The earlier production saved-house run (`prepared-walls`) passed navigation, recovery from the injected pause, complete saved lighting/reflections, edited-scene preparation and WebGL error checks. Its maximum edit/navigation draw gap was **58.1 ms**, so the explicit **50 ms release budget failed**. The preceding run measured 45.1 ms; this variation is why one passing run is insufficient.

Cold preparation still recorded a **404 ms** foreground task. The profile identifies first-use graphics-program initialization in the postprocessing path as a remaining source of blocking work. These changes remove the measured multi-second preparation freezes and camera catch-up, but do **not** establish a stall-free viewport. Further isolation of rendering/graphics initialization is required before making that claim.

The production build and focused geometry/scheduling/resource regressions pass. The wider suite checked during this work passed 819 of 824 tests; five house-fixture tests access a third floor absent from the current JSON fixtures. The user's saved house files were not rewritten to satisfy those tests.

Regenerate the lossless compressed RoomEnvironment asset after deliberately changing its source or filter settings:

```powershell
node tests/browser/viewportResponsiveness.mjs 5181 0 --bake-environment
```

The `.bin.gz` asset contains the original half-float cube-UV pixels; no runtime environment convolution or lossy image conversion is needed.
