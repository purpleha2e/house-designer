# Basic scene load diagnostic

Start the asset portal as usual, then run:

```powershell
node tests/browser/serveBasicSceneDiagnostic.mjs
```

Open http://127.0.0.1:5185/tests/browser/basicSceneDiagnostic.html?basic-scene
for production React and bundled workers. The page loads `colin_house_v2.json`
by default and has an **Open another JSON** button. Reload starts a new scene
and WebGL context. The production diagnostic is separate from the editor build.

For development, open the same path on the Vite port. App/module startup is
shown separately from the model-loading timer; neither build time nor file-picker
dwell time is counted as JSON loading.

The diagnostic uses the existing ThreeDView geometry path: room/roof preparation,
wall cutting, material-group geometry, selection buffers, procedural windows,
and imported model geometry. Saved model definitions are registered before
normalizing floors. It does not restore saved GI or fetch the material catalog.
Surface textures and GLTF material loading are bypassed. GLB files can still
contain embedded image bytes, even though those images are not decoded or uploaded.

The normal display renderer, shader warmup, texture preloader, PBR environment,
light pool, GI, and postprocessing are not mounted in this mode. Once preparation
has completed and the scene is stable for 500 ms, visible meshes are copied into
a display scene sharing their original vertex buffers. Instances are expanded to
ordinary mesh transforms. All meshes, including glass, use the same opaque raw
shader; colours encode surface normals without any lighting calculation. There
are no texture reads or displacement shaders. Camera movement remains available.

## Interpreting the timings

- **Read/fetch JSON:** local HTTP transfer/text decoding, or `File.text()` after selection.
- **Parse JSON:** only `JSON.parse`.
- **Normalize/register:** saved model definitions and floor normalization.
- **Meshes + model assets:** elapsed time from mounting the real geometry pipeline
  until tracked preparation and mesh changes finish. Includes worker startup,
  imported geometry fetch/parse, React work and scheduling; not pure CPU time.
- **Readiness check:** the explicit 500 ms stability interval, reported separately.
- **Basic draw snapshot:** constructing display objects sharing the prepared buffers.
- **First draw CPU call:** initial buffer upload, single-program initialization,
  and draw submission. Does not by itself measure all GPU execution.
- **JSON start → GPU done:** a nonblocking WebGL fence polled on subsequent frames;
  an upper bound on GPU completion, not a physical-monitor presentation measurement.

The initial production run measured 290 ms reading, 11.3 ms parsing, 5.3 ms
normalizing, 3,737 ms mesh/asset preparation, 504 ms stability checking, 3.3 ms
snapshot creation and 91.3 ms first-draw submission. GPU completion was observed
4,709 ms after starting the JSON request. Application code was ready about 2.1 s
after navigation, before that timer started. The development run took 7,071 ms
from JSON request to GPU completion. These are local observations, not budgets.

The final production verification measured 107 ms reading, 12.1 ms parsing,
5.3 ms normalizing, 4,548 ms mesh/asset preparation, 507 ms stability checking,
3.6 ms snapshot creation and 179 ms first-draw submission. GPU completion was
observed at 5,426 ms; application startup took 1.45 s separately. Thus the two
production observations span 4.7–5.4 s for model loading and about 6.8–6.9 s
including application startup. The final report uses the `production-final` suffix.

Both runs drew 691 meshes / 466,619 triangles with exactly one GPU program,
zero GPU textures, no texture network requests, no GI, disabled shadows and no
WebGL errors. The browser check uses a separate fresh browser profile:

```powershell
node tests/browser/basicSceneDiagnostic.mjs 5185 production
```

It writes the report and screenshot to `.tmp-basic-scene-production.json` and
`.tmp-basic-scene-production.png`. To rebuild an already running production
server's files, use `serveBasicSceneDiagnostic.mjs --build-only`.

## Opaque colours and textures

**Measurement correction:** the later PBR comparison found that the base-only
loader attempted canvas resizing of compressed KTX2 textures, then treated the
resulting exception as a load failure. The historical 17-texture colour-stage
measurements below therefore include imported-model maps but omit compressed
surface colour maps. They are superseded by the corrected comparison in the PBR
section. The loader now preserves compressed/data textures and their mip chains;
only drawable image textures use canvas resizing. The browser regression now
also requires an actual room-floor colour map, not merely any texture upload.

Open the same diagnostic with `&opaque-materials`, or use its comparison link:
http://127.0.0.1:5185/tests/browser/basicSceneDiagnostic.html?basic-scene&opaque-materials

This stage loads the material catalogue, base colours and base-colour textures.
Imported GLTF materials are created directly as opaque unlit materials, without
requesting normal/roughness/transmission maps. Surface finishes use the existing
base-only texture path and its texture-size limit. The display materials preserve
colour, texture UV transforms, vertex colours and polygon offsets, but have no
transparency, alpha testing, environment maps or lighting. Shader warmup remains
absent: no glass, fading, selection or postprocessing variants are precompiled.
This is an **unlit opaque-material experiment**, not a full PBR rendering benchmark.

Both diagnostic modes exclude fully invisible picking surfaces and colour-write-disabled
shadow/picking geometry. The original basic test included some of these helpers;
the opaque experiment revealed them as black patches. Corrected reports use
`basic-visible-final` and `opaque-visible-final` suffixes.

The texture stage currently waits for the prepared scene before its first draw.
Its total therefore measures readiness of the textured view, rather than the
earliest basic preview a progressive loader could show. The catalogue request
is included in the model-loading total and listed separately in the display.

```powershell
node tests/browser/basicSceneDiagnostic.mjs 5185 basic-visible-final
node tests/browser/basicSceneDiagnostic.mjs 5185 opaque-visible-final --opaque
```

Run the browser measurements sequentially to avoid competing for CPU/GPU resources.
The opaque test requires nonzero texture uploads and network requests, shared
shader programs across material instances, zero transparent display materials,
no GI, disabled shadows and no WebGL errors. App startup and the explicit 500 ms
readiness check remain reported separately.

Final sequential production measurements after excluding helpers:

| Stage | Basic | Opaque colours/textures |
| --- | ---: | ---: |
| JSON read + parse | 135 ms | 165 ms |
| Material catalogue | none | 356 ms |
| Mesh/model-asset preparation | 3,570 ms | 4,467 ms |
| Stability interval | 506 ms | 502 ms |
| First draw submission | 228 ms | 929 ms |
| JSON request to GPU completion | 4,531 ms | 6,501 ms |
| Programs / uploaded textures | 1 / 0 | 2 / 17 |

The opaque scene used 374 display materials sharing two programs, with zero
transparent display materials. It drew 690 meshes / 466,558 triangles; the basic
scene drew 660 / 466,437. The material catalogue enables additional floor finish
surfaces, and imported material sharing affects batching, so those counts are
not identical. This measures the added material pipeline, not just a shader swap.
The first-draw interval includes texture/buffer uploads and program initialization;
it is not a shader-compilation-only measurement. Prior opaque observations were
5.6 and 6.8 s. Do not interpret a single run's difference as a fixed cost.

## Opaque PBR maps

Use the **Opaque PBR** comparison link, or open
http://127.0.0.1:5185/tests/browser/basicSceneDiagnostic.html?basic-scene&pbr-materials

This stage uses ordinary MeshStandardMaterial with base colour, normal,
roughness, metalness, AO and emissive maps wherever assigned. GLTF packed
metallic/roughness maps retain their standard channel interpretation, texture
transforms and normal/occlusion strengths. Colour and emissive textures are
sRGB; the other maps remain linear. Surface textures use the existing PBR
quality path, so this stage also removes the base-only texture-size limit.

One fixed directional light and a hemisphere fill make the material response
visible. Both are unshadowed. No environment reflections, GI, postprocessing,
transparency, displacement or shader warmup are enabled. This compares the
additional maps **and simple PBR lighting**, not maps sampled by an unlit shader.
The material map counts show what is actually bound; a supported map type can
still have zero instances in this particular house.

```powershell
node tests/browser/basicSceneDiagnostic.mjs 5185 pbr-production --pbr
```

The regression checks real normal/roughness/metalness bindings, two fixed lights,
shared programs, opaque materials, complete preparation and no WebGL errors.

Corrected sequential production comparison, with all surface colour textures
present in both modes:

| Stage | Opaque colours | Opaque PBR + fixed lighting |
| --- | ---: | ---: |
| Mesh/model-asset preparation | 4,592 ms | 5,812 ms |
| First render call (uploads/program setup included) | 1,096 ms | 2,305 ms |
| JSON request to GPU completion | 6,469 ms | 8,963 ms |
| GPU programs | 2 | 5 |
| GPU textures | 23 | 55 |

Both runs have 690 meshes, 466,558 triangles, 374 materials and 86 colour-mapped
material instances. PBR adds 80 normal-mapped, 77 roughness-mapped and eight
metalness-mapped materials. No AO or emissive maps were bound in this scene.
An earlier PBR observation was 9,140 ms. Neither stage creates transparent
display materials. The total includes the reported approximately 500 ms
stability check, and excludes application startup (about 2.3 s in these runs).
The reports are `.tmp-basic-scene-opaque-textures-fixed.json` and
`.tmp-basic-scene-pbr-final.json`. Both browser regressions and the production
build pass. Screenshots confirm the floor colour texture and PBR detail render.


## Progressive startup in the normal viewport

The normal editor/viewer now displays an opaque PBR snapshot as soon as geometry
and its model assets settle. It uses the same normal/roughness/metalness maps and
two unshadowed lights as the PBR diagnostic. It shares geometry and textures with
the live scene, with disposal leases protecting them if the source changes.
Picking and camera controls remain attached to the original scene.
The first model display is this opaque PBR scene. The older wireframe bounding-box
startup fallback is no longer mounted; the loading indicator remains until PBR
is ready, then lighting prepares while the opaque scene stays visible.

After that display draw reaches a nonblocking GPU fence, direct lights and the
GI controller mount. A second opaque snapshot uses the actual unshadowed scene
lights, room masks and shared diffuse-light uniforms. Its standard PBR materials
omit environment reflections, transparency, shadow receivers and postprocessing.
It compiles independently while the original opaque snapshot keeps rendering.
Saved diffuse data is decoded and uploaded independently of reflections and can
be published through those shared uniforms without another shader compilation.

Only after the first lit draw reaches the GPU do environment uploads, full shader
preparation, saved reflections and postprocessing start. Full shader preparation
waits for restored reflection assignments so it prepares their actual variants.
The lit snapshot keeps rendering with the live camera until the full scene is
ready. Geometry and source picking targets are shared throughout. Existing
cooperative scheduling gives navigation priority; continuous movement can postpone
background work. With no valid saved cache, direct lighting still becomes usable
first and the existing bounded incremental bake continues after full preparation.

The environment loader has its own Suspense boundary inside a stable provider,
so enabling it does not remount the geometry subtree. Window frame geometry is
also independent of reflection/material changes. Floor/stair/roof cutout inputs
and per-room ceiling faces are memoized against geometry changes, preventing
lighting/status renders from replacing unchanged floor and ceiling buffers.
Batched and instanced model
transforms survive the opaque display copy.

Exercise the real renderer (including saved lighting) with:

```text
http://127.0.0.1:5185/tests/browser/basicSceneDiagnostic.html?progressive
node tests/browser/basicSceneDiagnostic.mjs 5185 progressive --progressive
```

This uses the existing production diagnostic server. The progressive query does
not enable any of the basic-scene rendering bypasses. Its browser regression
checks camera movement both immediately after the opaque frame and after full
shader compilation begins, continued display frames, geometry retention at
handover, and WebGL/console errors. `scene.userData.progressiveStartup` reports
opaque/full display times measured from SceneRenderer mounting; these exclude
JSON fetch, parse, catalog loading and application startup, unlike the standalone
JSON-to-GPU total above. The user's repeated opaque PBR baseline is about 6.5 s;
individual isolated Chrome runs on this test machine differ.


Initial verified progressive run: opaque display reached GPU completion at 6,624 ms
from renderer mounting; full-renderer handover occurred at 69,728 ms while the
opaque scene continued drawing. Both navigation samples had a maximum frame gap
of 16.8 ms. 590 of 608 original geometry buffers remained at handover (792 of
810 final mesh objects used original buffers); the named floor/ceiling meshes
were retained. Saved GI subsequently reported ready/displayed, 496/496 entries,
14 rooms and 14 reflections, with no GI geometry rebuilds. No console/WebGL
errors occurred. These are observed timings, not a guarantee of every driver's
shader compilation latency. The diagnostic overwrites `.tmp-progressive-startup.json`
and the opaque/full PNG captures on each run. Production build and 62 focused
tests passed for that initial implementation.

### Full-renderer preparation profiling

`scene.userData.shaderWarmupProfile` now records scene/snapshot preparation,
shader compilation, resource preparation and postprocessing separately, with
submission and completion times for each shader batch. The progressive browser
report also records the GPU, parallel-compilation support and program inventory.

The profiled GPU was an AMD Radeon Pro 5600M through ANGLE/D3D11, with
KHR_parallel_shader_compile available. The full path prepared 57 programs:
22 physical/PBR, seven depth, seven distance, 12 basic and nine other programs.
Programs are shared across materials; one had 193 material users. Saved GI was
restored with 496/496 entries and no GI geometry builds or capture time. The long
wait was therefore full-renderer preparation, not recomputing that saved bake.

Two avoidable costs were found and changed:

- The compile queue waited for each small submission slice to finish before
  submitting more shaders. It now allows four batches in flight, yielding for
  navigation and draining outstanding work before cancellation disposes materials.
- Display PBR shaders included ray/triangle occlusion routines used only during
  lighting capture. A runtime uniform disabled them, but drivers still compiled
  the code. `HD_GI_CAPTURE_VISIBILITY` now excludes it from display programs and
  enables it on capture copies. Capture and warmup copies preserve custom defines.

The profiling runs varied substantially in overall performance: opaque startup
itself took 22–40 seconds rather than the earlier 6.6 seconds. They are not a
controlled speedup comparison. Shader compilation measured 141.5 seconds in the
initial instrumented run (also affected by a concurrent build), 58.3 seconds with
the queue change, and 24.6 seconds after the display/capture separation. The last
run still took 25.8 seconds to opaque display and 85.2 seconds to full handover;
resource preparation alone took 10.5 seconds. Full lighting startup remains too
slow and these changes must not be described as solving the complete delay.

Reports were preserved as `.tmp-lighting-profile-before.json`,
`.tmp-lighting-profile-queue.json` and `.tmp-lighting-profile-display-only.json`.
The final browser run retained geometry, restored saved GI, supported camera
movement and reported no WebGL/console errors. Its maximum navigation frame
gaps were 66.7 and 83.3 ms, so it also does not establish hitch-free navigation.
The capture, GI and shader-warmup focused suite passed 49 tests.

The opaque display now records geometry uploads after each mesh's first draw.
Full-lighting resource preparation reuses those entries instead of running another
preparation render for every unchanged buffer. Attribute replacement/version
changes, geometry disposal and renderer context replacement invalidate readiness.
Only meshes that actually reach the display callback are recorded.

A subsequent run (`.tmp-lighting-profile-buffer-reuse.json`) measured 8,443 ms
to opaque display and 28,216 ms to full-renderer handover. Shader preparation was
9,441 ms and resource preparation was 586 ms. This is an observation, not an
isolated comparison with the much slower earlier runs. The test deliberately
includes eight seconds of navigation, which can pause background work. Saved GI
was subsequently ready with no capture or geometry rebuild; handover time is not
a separate measurement of when saved GI finished restoring. Navigation, geometry
retention and WebGL checks passed, as did 18 focused tests.

### Staged lighting display

The separate first-lighting stage described above is now implemented. Diagnostics
include `lightingCompileMs`, `lightingReadyMs`, `diffuseReadyMs` and `fullReadyMs`.
Opaque, direct-light and saved-diffuse milestones use nonblocking GPU fences.
The first lit stage uses five additional programs in the measured house, sharing
standard PBR shaders across finishes. Room masks use unshadowed lamp room IDs in
this stage even when final shadow maps are enabled. Point/spot/directional light
positions, targets, colours and intensities stay synchronized while navigating.

Large data textures still upload in small regions, but now yield after at most
512 KB or about 2 ms of submitted work rather than after every 64 KB region.
This removes thousands of minimum-delay timer waits without one large upload.
GPU regression checks confirm exact 2D/3D values, retained previous texture data,
reflection agreement and safe cold shadow preparation.

For startup timing without deliberate navigation pauses:

```powershell
node tests/browser/basicSceneDiagnostic.mjs 5185 staged --progressive --stationary
```

A measured stationary run reached opaque display at 7,642 ms, direct lighting at
9,145 ms, saved diffuse lighting at 10,474 ms and full effects at 20,111 ms, all
from renderer mounting. The first lit shaders compiled in 856 ms. These are
observations on this machine, not guaranteed cold-driver timings. The report is
preserved as `.tmp-staged-lighting-stationary.json`. The normal regression retains
navigation checks; `--no-saved-lighting` also tests direct/full startup without
waiting for a new bake to finish.

Incremental bake scheduling, retention of previous lighting and synchronous shadow
toggles remain active. Focused regressions cover regional invalidation, bounded
preview work, unchanged-room retention and buffer/texture lifetimes. The full
effect shader family still has more variants than the early display; this change
removes it from the first-lighting gate rather than claiming to eliminate its cost.

Final validation: 46 focused tests and the GPU resource regression passed. The
saved-cache navigation run preserved 590/608 original geometry buffers and showed
maximum sampled frame gaps of 16.8 ms during both initial navigation periods.
The no-cache run reached direct lighting at 10,085 ms and full effects at 19,330 ms;
it deliberately moved for two seconds while full effects compiled, with 124 sampled
frames and a maximum gap of 33.4 ms. It verified startup without waiting for a new
bake, not completion time for that bake. Reports are
`.tmp-staged-lighting-navigation.json` and `.tmp-staged-lighting-no-cache.json`.
