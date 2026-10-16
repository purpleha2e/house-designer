# Cached indoor PBR lighting

The editor and read-only viewer use the same lighting and colour pipeline.
Paint colours and imported base-colour textures are preserved. Colour textures
are sRGB; lighting and the probe cache are linear; display output is sRGB.
Both the direct renderer and the AO post-processing chain apply ACES filmic
tone mapping at exposure 1. The post-processing composer disables renderer
tone mapping, so its explicit ToneMapping effect is necessary.

## Diffuse lighting

PBR environment maps provide reflections without adding diffuse studio light.
Indoor surfaces instead sample a cached, world-space irradiance field. Outdoor
surfaces retain the sun and sky/hemisphere fill. The existing ambient slider
provides an adjustable indoor fill for readability; setting it to zero removes
that fill. Night fill can be disabled separately.

Wall-mounted window and door geometry carries local receiver planes just beyond
the owning wall face. Room-facing frame surfaces sample the room even when the
frame sits inside a thick wall, outside the ordinary indoor occupancy mask.
Outward-facing surfaces keep exterior lighting. Tangential edges choose the
viewed side, including during probe captures; interior doors can sample either
adjoining room. Geometry away from the wall, such as a swung leaf, retains its
ordinary spatial sampling. Receiver buffers are shared across matching instances
and released when their last owner unmounts. Cache version 3 rebuilds older bakes
so their bright frame contribution cannot remain in the stored diffuse field.

Render settings also includes an **Indirect lighting (GI)** switch. It toggles
the displayed diffuse probe contribution while preserving the ambient fill,
direct lights and reflection shading. It does not invalidate the bake or change
probe captures, so it can isolate GI artefacts in an immediate comparison.

**Inspect GI point** arms a surface picker. Close the settings menu and click
the affected carpet after GI is ready. A separate worker compares the displayed
filtered volume with exact geometry-visible probe blends at the receiver and at
the offset sampling point. The panel also evaluates nearby probes in the same
surface direction; the visible side of a debug sphere can have a different
colour from its upward irradiance. Download report preserves the positions,
RGB irradiance, support, probe visibility, first-pass irradiance when available,
and direct lamp visibility. Inspection works on restored caches, does not rebake
or modify lighting, and cancels when disabled. These are geometry-normal readings
before material textures and ambient fill. An exact blend uses the same captured
SH coefficients, so matching results still need a capture/bounce investigation;
the inspector does not claim to validate the physical lighting.

Each storey has a regular world-space grid, normally spaced two metres apart,
with two probe heights. Room polygons help place probes inside the building;
they do not select a room's lighting tile or restrict interpolation. A binary
occupancy mask distinguishes indoor from outdoor surfaces and stores the first
structural ceiling/roof height, preventing indoor shading on exterior roof faces.
Nearby probes blend with a smooth distance kernel at their actual positions.
Narrow spaces receive supplementary probes when the regular grid misses them.
Probes relocate away from furniture and below sloping ceilings. After relocation,
samples closer than 60 cm with unobstructed visibility share one capture. Solid
walls and separate storeys retain their own samples. Existing saved lighting
keeps its baked layout until a lighting or geometry edit triggers recalculation.
A static BVH raycasts the actual scene into octahedral surface-reference maps for local lamps: solid
walls reject local lights behind them, while openings allow light to cross room labels.
The display budgets direct lights by fragment-uniform capacity (up to eleven),
separately from the texture budget for real-time shadow maps. Lights beyond the
shadow-map budget still illuminate their rooms using this geometry visibility;
room masks supply fallback occlusion before that data is ready. Selection does
not change which lights emit light or receive shadow slots.
The atlas allocates space for the actual lamps rather than all diffuse probe slots.
Probe layout, world-space triangle expansion, BVH construction and ceiling
occupancy build in a dedicated Web Worker. Large scenes (at least 25,000
triangles) split lamp visibility rows across up to three helper workers when
at least four logical cores are available. Helpers import alongside BVH
construction, then deserialize copies of that tree and its original triangle
positions. They preserve the reordered index and surface-reference IDs without
rebuilding the BVH. Each helper gets a disjoint range of rows; returned row
buffers transfer back into the unchanged atlas layout. Immutable geometry is
cloned, so this needs no SharedArrayBuffer or cross-origin isolation headers.
The renderer client owns and terminates all helpers on completion, failure,
or cancellation. Helper failures fall back to the coordinator's serial raycasts.
Small scenes stay serial to avoid startup/copy overhead. The prepared cache
becomes available after all queries complete. No CPU raycasts run in React render
or an editor frame callback.

During one probe layout, each room's 24-by-24 relocation candidate positions and
wall clearances are computed once and reused across grid nodes. Room bounds
reject irrelevant candidates and mask polygon tests before exact geometry work.
The exhaustive search's positions, tie ordering and support radius are preserved.
Engine activity distinguishes layout, geometry indexing, structural indexing,
probe clearance, ceiling queries, lamp queries, table setup and zone planning.
`scene.userData.indirectLighting.prepareTimings` records those stages in
milliseconds; `prepareMs` also includes worker startup, message copies and queueing.
`node tests/browser/giPipelinePerformance.mjs 5182 colin 120 --prepare-only`
measures preparation separately from captures. A local development run reduced
Colin's preparation request from 12.23 s to 8.69 s, layout from 1.77 s to 0.23 s,
and lamp visibility from 4.64 s to 2.73 s. These are individual measurements on
the same machine, not guarantees for other scenes or hardware.
Maps use 512 samples per axis for up to eight lamps, 256 for up to 32, and 128
thereafter, bounding atlas storage. Source positions and cached geometry use
full precision; irradiance coefficients remain half-float.
Only the geometry normal affects visibility; texture bumps affect shading.
The field stores first-order RGB spherical harmonics. Visibility blending is
precomputed with exact BVH visibility segments into a 3D irradiance volume in
the worker after each bounce pass. Both the main view and captures use
four filtered half-float reads from one packed 3D texture for diffuse GI. RGB
stores each SH coefficient; alpha records whether a sample has visible probe
support. Filtering is normalized by that coverage, so voxels inside a solid do
not add artificial black patches, while valid unlit samples remain dark.
Probe-to-volume visibility segments stop only 1 mm short of their endpoint.
These segments use an allocation-free any-blocker traversal over a surface-area
heuristic BVH. They stop at the first blocking triangle; lamp surface references
and ceiling queries still request the nearest hit. The traversal copies topology
through the BVH's public API and preserves the same two-sided triangle tests and
near/endpoint tolerances. Probe neighbourhoods and segment results are reused
across volume previews and bounce updates.
A previous 4 cm tolerance accepted samples inside thin partitions and allowed
neighbouring-room light to bleed into the filtered volume.
Ceiling-border voxels extend the interior light below the actual ceiling rather
than sampling the attic. Exterior receivers still fail the occupancy test.
The second bounce reads
the completed first-bounce volume, never partially updated probe coefficients.
Completed bakes also retain first-pass coefficients for incremental updates.
Adding, removing, moving or resizing a wall window/door, standalone furniture,
or a lamp selects affected room zones, zones with a view of the old/new bounds,
and visible neighbouring zones
for the second bounce. Unaffected probes and reflection captures are reused.
Room labels select bake work; they do not introduce lighting boundaries.
The shared geometry visibility and irradiance volume are refreshed to reflect
the new opening. Global sun/settings edits, structural changes, finishes and
other unsupported edits still perform full bakes. Interrupted updates compare
against the last completed bake. First-pass data saves with the project;
older caches remain readable but need one full refresh before local updates.
The receiver offset accounts for the volume's filter footprint to reduce sampling
dark voxels inside a wall or above a ceiling.
The volume normally uses approximately 16 cm plan spacing and twelve heights
per storey, with duplicate vertical borders to avoid filtering between storeys.
Large plans cap each horizontal axis at 128 samples.

Upward-facing finishes within 8 cm of the storey floor use a separate SH layer
with approximately 4 cm plan spacing, capped at 512 samples per axis. Its samples
sit 16 mm above the structural floor (4 mm above the standard finish). Four
filtered coefficient reads preserve visibility below raised furniture without
blending the carpet with the taller volume samples. The receiver offset is 4 mm
for these surfaces; walls, ceilings and higher surfaces retain the original volume.
Floor blends bound their normalization divisor to at least 0.1 of kernel support.
Below that support, irradiance fades proportionally instead of amplifying a lone
distant probe to full brightness after furniture blocks every nearby sample.
Well-supported blends keep their original irradiance. This confidence attenuation
is stored in RGB, separately from binary coverage, so filtering cannot cancel it.
The floor layer reuses cached BVH segments across bounce passes. It is compressed
and saved alongside the volume. Older saved lighting builds only this layer in a
worker from its existing coefficients and scene geometry, with no new probe or
reflection captures. Save after this refinement to avoid repeating it on load.
Version 1 floor layers also regenerate this way; new saves store version 2.

Raised furniture also receives additional captured probes in its open underside.
The worker samples its bounds on a 75 cm grid, finds the actual downward-facing
underside with the geometry BVH, and checks clearance before placing probes below
it. Solid plinths receive none. Placement adds at most 128 probes and preserves
the regular atlas slots. These are ordinary two-pass radiance captures, so floor
lighting under a bed has measured local support instead of a sharp missing-data
shadow cast by probes above the bed.
The saved layout records `floorProbeLayoutVersion: 1`. An older editor bake keeps
its completed display while preparing the new layout. When saved first-pass data
is available, only affected regions and their second-pass dependencies recapture;
otherwise a complete bake is required. Solid furniture with no new underside
samples reuses its existing bake. Saving a completed upgrade prevents it repeating.
The read-only viewer uses the published saved layout without starting new captures.

The Render settings menu includes a Diffuse probe resolution slider: 4 × 4,
8 × 8 or 16 × 16 samples per cubemap face, with 16 × 16 as the default.
The setting is saved with the project even before a bake completes. Changing it
rebuilds diffuse lighting; saved caches record their resolution and older caches
use 16 × 16. Reflection captures keep their separate 64 × 64 resolution.
The progressive bake renders the selected cubemap size with linear HDR output.
Stationary frames submit up to six faces within an 8 ms CPU submission budget,
reduced to 4 ms when the previous frame was slower than 25 FPS. Navigation uses
a 3 ms budget and the throttling described below. A slow idle frame no longer
restricts the next submission to one face. First-order RGB spherical harmonics
are integrated on the GPU into four half-float pixels, followed by one asynchronous
readback per probe. Up to three readbacks can be in flight: stationary, inexpensive
frames start another probe instead of waiting for the previous GPU copy. Each
read owns its CPU pixel buffer; the cubemap and integration target are reused
in GPU command order. Every outstanding read drains before the next bounce or
reflections start, and obsolete generations cannot publish their results.
Cleanup retains capture resources until all their readbacks settle.
This replaces six sequential full-face readbacks and CPU integration.
On startup, probes nearest the initial camera
are captured first. Both startup and edits publish live previews after at least
four new captures and 300 ms since the previous request. There is at most one
preview request in flight, and captures continue while it runs. Display-only
preview volumes use 64 cm plan spacing capped at 32 samples per axis; their floor
layer uses 16 cm spacing capped at 128. The final volume and 4 cm floor layer keep
their original resolution. The smaller preview has less spatial detail, and full
refinement can change light near thin partitions and furniture.
Uncaptured probes do not count as black illumination; captured dark probes retain
valid support. For edits, compatible old probes retain their final lighting. New
first-bounce captures apply a direct-light delta to that old result until the
second bounce replaces it. Preview coefficients and textures never become bounce
inputs or an exportable bake. Captures pause at pass boundaries until the complete
full-resolution input for the next bounce is ready. The editor's GI indicator
distinguishes preparation, building, refinement and completion. The grid
captures direct scene light and sky visibility, followed by an indirect pass
for diffuse colour bounce. Named glass materials transmit light during capture.
Camera-dependent wall/roof fades and selection decorations do not alter the bake.
Invisible editor picking surfaces are excluded from captures. Diffuse captures
use a retained, flat scene built once per lighting update. It shares the live
geometry, textures and existing sun shadow map, but owns separate capture
materials. Solid wall/roof fades become opaque and write depth in those materials;
glass and transparent editor helpers are hidden. No live materials or editor
visibility are changed for diffuse faces. Compatible ordinary meshes sharing a
world transform, material and nearby spatial cell are merged without rebaking
vertex coordinates. Instanced, skinned, mirrored, grouped-material and callback
meshes retain their original rendering semantics. Only capture materials, merged
buffers and cloned instance resources are disposed with this scene.
Reflections retain the live-scene path: transparency flags remain intact, and
temporary opacity, visibility and depth-write changes are restored after capture.
The progress diagnostics record scene-build time, source/merged mesh counts,
capture draw calls and triangles. `giPipelinePerformance.mjs --compare-captures`
compares sampled cubemap faces across both bounces with the live-scene reference;
these synchronous diagnostic reads are excluded from ordinary performance runs.
On a local AMD Radeon Pro 5600M development run, the clean lighting-startup scene
completed in 2.11 s after preparation, with 71.8 ms of capture CPU submission;
all 36 sampled faces matched the live-scene reference exactly. Colin's 144 sampled
faces also matched exactly. Its trial bake fell from 54.43 s to 43.57 s, but
startup GLTF texture errors mark those Colin reports invalid, so that timing is
provisional rather than a clean performance comparison.

An experimental surface-transport cache separates direct lighting from surface
data. The ordinary PBR shader records its radiance, volume/floor receiver position,
shaded world normal and diffuse response in four render-target attachments during
the first geometry draw. Fullscreen copies store its direct radiance in a separate
atlas, preserving PBR lighting and sun shadow filtering. Pass two
relights those samples with fullscreen draws and uses the existing SH reduction,
rather than drawing the building again.
The response retains colour/normal maps, metallic diffuse attenuation, AO maps
and fog. Sky samples remain direct radiance. Windows and sun illumination still
use the existing first-bounce geometry capture; directional window transfer and
direct relighting from cached geometry are subsequent work.

The first bake records direct light and surface data in the same geometry draw. Later
lighting-only updates capture direct radiance and reuse the geometry data;
sun and lamp power changes therefore skip the data pass and second-bounce
geometry draws. Geometry, normals, UVs, receiver offsets, texture contents and
transforms, finish uniforms, fog, layout or resolution changes replace it. Partial
updates recapture affected direct-light samples and use ordinary rendering for
any second-bounce sample without cached surfaces. Captures and shader compilation
retain their resources until outstanding reads/compilation settle. Memory is
bounded to 64 MiB; unsupported float MRT hardware, oversized layouts, physical
transmission and custom shader materials fall back to the ordinary bake.

This cache is **disabled by default** while initial latency and broader hardware
coverage are evaluated. The first bake draws 1,530 geometry faces for Colin,
including reflections, and reuses 1,446 second-bounce faces. A lighting-only bake
also draws 1,530 faces, retaining all surface data. `surfaceDataFaces` counts faces
whose transport data is first recorded; those draws are already included once in
`capturedFaces` and the geometry draw/triangle totals. The previous separate-data
prototype drew 2,976 geometry faces on startup; its timings do not describe the
combined implementation. Small-scene comparisons of both combined bounces match
ordinary geometry captures within half-float precision. The full Colin comparison
also passes. Its combined cache uses about 21.7 MiB and submits 236,843 geometry
draw calls instead of the ordinary path's 460,091. First-draw shader/driver stalls
of roughly 10–12 seconds still prevent enabling it by default. A direct-only
shader define removes volume sampling from this material variant, but does not
eliminate those stalls. Warm sun edits retain the same cache, record zero new
surface-data faces and replay all 241 second-bounce probes. This still rerenders
direct lighting; it is not yet a geometry-free relighting system.

Use `node tests/browser/giPipelinePerformance.mjs 5182 colin 150 --surface-cache`
for an experimental timing run, and `--compare-surfaces` for sampled first/second
bounce comparisons against ordinary geometry captures. Comparison runs include
extra reference draws and must not be used as performance measurements.
Add `--relight-sun` to measure a second bake after a sun edit and assert that it
retains the same cache with zero new surface-data faces. Reports retain separate
initial/update timings. `lightingStartupRegression.mjs 5182 lighting-startup
--live --surface-cache` checks surface reuse during sun and lamp power edits,
preview continuity, cancellation and navigation shader reuse.
`indirectLightingZonesRegression.mjs 5182 --surface-cache` tests window edits and
reloads with the experiment enabled. The live diagnostic switch is
`scene.userData.indirectSurfaceCacheEnabled = true`; it takes effect on the next
lighting update. The normal bake remains the default.

Captures use nearby local lights across the building, independently of room labels,
the viewer's active floor or the direct-light pool. The GPU texture budget limits
the set to at most eight lights. Cached geometry references occlude local
lights during capture without extra shadow passes. Four neighbouring references
select unique candidate faces, which are checked against the actual receiver
ray and triangle boundaries. Consecutive source triangles stay paired so quad
diagonals do not create gaps. Coplanar pairs have a cheap plane rejection before
fetching vertices. A bounded 3 mm edge tolerance closes small mesh seams.
This avoids extending a sampled plane beyond its geometry, which caused
oversized shadow wedges and jagged silhouette edges. The geometry table is
shared by all lamps and rebuilt with the visibility BVH.
Existing sun shadows are reused.
Cached lamp-to-surface references are used only during offscreen GI captures,
where they prevent baking light through solid geometry. The displayed scene
uses the renderer's direct-light path. With **Light shadows** enabled and shadow
maps available, direct lamps cross room boundaries through clear openings;
geometry blocks their light and casts shadows in adjoining rooms. Without local
shadow maps (including when Shadows is off or in XR), the room mask remains the
fallback to prevent unshadowed lamps lighting through walls. GI never adds a second visible
direct-shadow test. Capture work is bounded to four cache references and at
most eight candidate triangles per lamp.

The **Light shadows** checkbox is a synchronous, scene-local display control.
It retains pooled shadow targets and the shader's shadow-light counts, sets
shadow intensity to zero, and disables shadow updates. Disabled receivers exit
before sampling the map. Targets are disposed only when their light is removed;
an initially disabled slot initializes its target once so its sampler is valid.
Re-enabling refreshes the existing map. Room-mask fallback changes in the same
event, without rerendering the full React scene tree.

This display option is excluded from shader warmup and indirect-lighting cache
invalidation. Captures use their own geometry visibility, so toggling local
shadow maps does not require another bake. The browser regression
`node tests/browser/lightShadowToggleRegression.mjs 5181` checks a 5 ms shadow
state-update budget, identical GPU targets/program IDs, unchanged GI generation,
and zero local shadow draws while disabled. Its optional fixture query
`"colin&materials&saved-gi"` exercises the saved house and lighting cache.
On the development-machine saved-house run, disabling applied to the lights
in 0.4–1.4 ms. Complete checkbox handling took 2.2–6.5 ms; this is not a
guarantee of a 5 ms total browser-event or display-presentation deadline.

Local point and spot shadow receivers use a 4 mm normal bias, a small perspective
depth bias, and a one-texel filter radius. The former 10 cm normal bias and larger
depth bias could leave a lit gap at thin doors and detach floor contact shadows.
The cross-room browser check includes a thin contact caster with two lights and
unobstructed floor samples to guard against detached shadows and self-shadowing.

Shadow filtering compares five texel-centre samples against the receiving
surface's plane, including point-light cube faces. Projected sun/spot taps also
cover the GPU's subpixel rasterization precision. Surface derivatives are
evaluated before light/frustum branches; taps outside the light's depth range
stay unshadowed. This avoids grazing-angle bands on walls and imported curved
furniture while retaining the small contact bias, without extra shadow fetches.
`localShadowReceiverRegression.mjs` compares flat and curved receivers against
unshadowed references for point, spot and sun lighting.

Solid inter-storey slabs retain an independent shadow-only top cap with the same
footprint and holes as their visible cap. Camera-based hiding of the visible
top face therefore cannot remove the boundary from local-light shadow maps
when walking downstairs. The cross-room regression moves the camera below the
slab while retaining the upstairs lamp and checks that no direct light passes.
Geometry smaller than a cache texel can still be missed; this is not a full
per-pixel BVH traversal.

## Reflections and lifetime

After the diffuse field settles, a 64-pixel room-centre cubemap is filtered with
PMREM and reused by environment-mapped materials belonging to one room. Materials
shared across rooms retain the generic environment with per-fragment attenuation;
this avoids splitting render batches or adding draw calls. These reflection maps
are an approximation and do not implement parallax correction or moving reflections.

Camera movement, AO changes and selection do not invalidate lighting. Geometry,
model transforms, material assignments, light settings and sun changes do.
Captures pause during model transforms, scene preparation and XR presentation.
During navigation, responsive frames allow one capture face at most every 50 ms;
frames below 28 FPS yield that work to navigation. Updates wait for 250 ms of
edit inactivity; repeated edits cancel obsolete worker preparation. GPU capture
shader variants are prepared asynchronously and retained for reuse before their
first render. Lighting hooks are attached before scene shader warmup. Composed
shader keys recognize inherited hooks anywhere in the key, and wall fade
materials survive navigation so approaching the same wall reuses its GPU program.
Initial display draws wait for assets, wall-clipping workers and shader warmup.
After startup, navigation, selection and dragging can draw the retained geometry while a
wall cutout is prepared; a stationary view retains its previous frame until the
geometry is ready. GI still waits for the completed geometry. PCF shadow
mode is selected before warmup, avoiding the renderer's deprecated soft-PCF
fallback compiling every material a second time. A project replacement commits
its floors together with its settings instead of rebuilding the outgoing floors
with the incoming definitions. During a bake, an unchanged display refreshes at
most ten times per second to leave GPU time for captures. Camera movement,
editing and XR retain the normal display cadence; completed lighting does too.
GPU capture and readback still belong to the renderer thread.
After geometry preparation, the GI worker builds exact probe-to-volume and
probe-to-floor visibility weights while GPU captures run. This geometry-only
work yields between rows after an 8 ms worker budget, allowing live previews
and edits to interleave. It never changes coefficients, display textures or
floor readiness. The first full volume request reuses completed weights and
finishes any remaining rows; subsequent bounces and lighting-only edits retain
the same weights. Replacing geometry cancels the old background work.
Project changes never await worker preparation or volume generation.
Ordinary window/door moves refresh openings without rebuilding room topology.
Unchanged storeys keep their prepared and roof-clipped walls. Room cutters include
opening voids, so moving an opening refreshes roof clipping at that opening.
Openings below all gable bases do not invalidate
gable geometry, while higher openings still do. The clipping client keeps up to
two idle workers ready for subsequent edits and terminates cancelled jobs.
Wall meshes retain loaded materials when their ordered finish palette is
unchanged. Shader warmup tracks program features rather than new material IDs
or uniform-only values such as roughness and opacity. Removing an instanced batch
for selection retains the already prepared superset of shader variants. Replacing
vertex positions therefore does not start another scene compilation. Local-light
pools reserve each kind's maximum installed count across visible floors,
including switched-off lamps. Unused slots stay visible at zero power so floor
selection and light toggles preserve shader light counts. Optional local-shadow
slots retain their maps while off and stop updating until used again. GI also
retains disabled lamps at their authored positions with zero power, preserving
visibility rows and prepared geometry across on/off changes.

Reflection or saved-cache replacement can request a shader-feature check without
introducing any new programs. If the prepared variants cover the current scene,
the check clears its pending flag even when the revision string is unchanged.
Otherwise that flag can freeze display draws and force another full scan on
every frame until a later lighting update changes the revision.
The upstairs light-checkbox regression exercises off/on/off from a saved Colin
bake. A local run displayed each change in 122–157 ms, with no display shader
compilation or scene warmup. The first edit after loading still prepared the GI
worker and its capture programs in the background; the repeated off cycle reused
them, displayed after 138 ms and finished refinement in 5.93 seconds. Returning
to the original on state restored the saved bake. The small-scene variant with
local shadows enabled also retains its shadow map and prepared geometry.
Selection bounds and transform-handle descendants are excluded from scene
shader-change detection. Stable handle/bounds prototypes and model-highlight
variants are compiled during startup and retained, so selecting or deselecting
a window or door does not compile shaders or invalidate GI.
The colour-picking pass hides entire selection-helper roots and restores them
afterwards. TransformControls updates its child visibility during rendering;
hiding only its meshes lets handles reappear in the pick buffer and compile
extra shaders with shadows disabled. The selection browser regression uses real
mouse clicks; run
`node tests/browser/selectionShaderRegression.mjs 5180 --colin --inside --switch-floor`
to select the upstairs patio doors from inside while editing the ground floor,
then check the two rear upper-storey windows with the saved GI. A local run
showed the first selection after 1.27 seconds and later selections around
0.35–0.45 seconds, with no new GPU programs or GI generation changes. A completed
valid bake reports ready while unrelated selection geometry is being prepared;
pending lighting updates still report their preparation wait.
Menu hover no longer pauses captures. The volume worker indexes nearby probes
spatially and caches compact probe-to-voxel visibility weights. Subsequent
previews, bounce passes and sun changes reuse those weights; coefficients are
decoded once per volume update rather than once per voxel contribution.
The shared direct-light room mask also rasterizes in a worker and is keyed to
room polygons and bounds, so furniture edits reuse it.
Sun-only changes reuse the prepared geometry and lamp visibility. Lamp power and
colour changes also reuse them; moving a lamp updates only its visibility tile
when the light count and geometry are unchanged. Furniture geometry changes still
prepare a new visibility structure, while unaffected probe captures are retained.
Unknown asset changes and structural edits keep the conservative full-bake path.
The last completed lighting remains visible until a live preview replaces it;
each replacement volume is published atomically. Superseded requests cannot
publish into a newer generation. Reflections are refined after the diffuse passes.
Once the queue is complete, there are no further capture renders or readbacks.
For a complete all-floors view, final PMREM reflections are read once for export.
The diffuse volume, occupancy, actual probe positions, coefficients and room
reflection textures are gzip-compressed and embedded in the saved project.
Save includes only completed lighting matching the current project. Loading
validates the cache version and project/asset/settings keys,
then restores GPU textures directly without GI preparation, capture shaders,
probe renders or visibility work. A lighting edit retains the displayed cache
while its replacement is calculated. A saved client tour does not start a new
bake if its embedded cache is invalid. The publishing build requires current,
decodable baked GI unless explicitly run with `--allow-unbaked` for development.
Capture targets, the visibility BVH, textures and shader hooks are released on cleanup.
The field supports eight storeys, up to 3,968 grid slots and 128 cached local-light
visibility maps. Large buildings automatically increase grid spacing. Reflection
placement supports 254 room regions. This is cached,
low-frequency GI, not a full path tracer; small contact shadows still come from AO
and direct shadow maps.

## Verification

Run `npm test` and `npm run build`. With Vite on port 5180:

```sh
node tests/browser/indirectLightingRegression.mjs
node tests/browser/indirectLightingRegression.mjs --local
node tests/browser/indirectLightingRegression.mjs --local --open --strict
node tests/browser/roomLightShadowsRegression.mjs 5180
node tests/browser/localShadowReceiverRegression.mjs 5180
node tests/browser/lightingStartupRegression.mjs
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14 --probes
node tests/browser/lightingStartupRegression.mjs 5180 lighting-startup --cache
node tests/browser/lightingStartupRegression.mjs 5180 lighting-startup --live
node tests/browser/modelLoadingPerformance.mjs 5180
node tests/browser/openingMovePerformance.mjs 5180 --assert
node tests/browser/selectionShaderRegression.mjs 5180
node tests/browser/selectionShaderRegression.mjs 5180 --colin --inside --switch-floor
node tests/browser/lampToggleRegression.mjs 5180
node tests/browser/lampToggleRegression.mjs 5180 --small --shadows
node tests/browser/savedLightingProjectRegression.mjs
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14 --cache
node tests/browser/indirectLightingRegression.mjs --house
node tests/browser/indirectLightingRegression.mjs --editor
node tests/browser/indirectLightingRegression.mjs --editor --artefacts --tag=check
node tests/browser/indirectLightingRegression.mjs --editor --corners --fast-bake --gi-only
node tests/browser/indirectLightingRegression.mjs --strict --updates
node tests/browser/indirectLightingRegression.mjs --editor --fast-bake --small --edit-performance
```

The model-loading benchmark uses the editor's Load action to switch from Colin
v2 to the actual `springfield_14.json` and reports scene readiness separately from
completed lighting. In the October 2026 headless Chrome run on the development
machine, scene preparation fell from about 110 seconds to 34 seconds; the full
switch including two GI bounces and reflections fell from 396 to 136 seconds.
Timings depend on hardware and cache state; final cache compression is excluded.

The normal, uncached Colin pipeline can be compared with
`node tests/browser/giPipelinePerformance.mjs 5182 colin 120` and the same command
with `--legacy-budget`. Matched clean October 2026 runs took 31.04 seconds with
the current idle budget and 39.87 seconds with the former budget: about 22%
faster after preparation. Both rendered 2,976 geometry faces, 460,091 draw calls
and 405,664,293 triangles for 241 probes in 14 rooms. This is the default path;
the experimental surface cache remains disabled.

Native GPU multiview is now enabled when `OVR_multiview2` and floating-point render
targets are available. It renders three neighbouring cube directions together,
then the other three, or three batches of two on hardware limited to two views.
It retains perspective cube projections and directly integrates six layers of an
RGBA16F texture array; it does not use nonlinear hemisphere projection. Unsupported
materials, clipping/fog configurations and hardware retain ordinary cube captures.
Navigation starts ordinary one-face captures; partially captured multiview probes
wait for navigation to settle. Reflection captures keep their existing path.
Matched clean Colin runs measured 32.47 seconds after preparation versus 36.21
seconds for ordinary capture, with 326,201 versus 460,091 submitted draw calls.
All 22 sampled first/second-bounce SH comparisons matched exactly. This reduces
submission work but still shades six views per probe and two bounces.
`--multiview`, `--multiview-2` and `--compare-multiview` exercise this path in the
pipeline profiler; plain profiler runs explicitly disable it for the control.
`scene.userData.indirectMultiviewEnabled = false` selects the ordinary fallback.

The completed-bake timing is fundamentally different from Lumen's frame budget.
This implementation samples the whole house with fully shaded geometry captures,
then builds the lighting volume. Lumen retains surface lighting, traces a cheaper
representation, and spreads lighting updates over frames. Replacing repeated
geometry captures with cached surface relighting is the next architectural step;
multiview alone cannot provide Lumen-like update costs. In the 32.47-second run,
the first full-resolution volume request alone took about 10.03 seconds, including
finishing geometry visibility weights; the second request took .58 seconds after
those weights were cached. These worker timings include queueing and copying and
must not be added to overlapping capture/readback totals. See Epic's
[Lumen technical details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine)
and [performance guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-performance-guide-for-unreal-engine).

Browser regressions own isolated Chrome profiles under
`node_modules/.cache/browser-test-profiles`, outside Vite's watched source tree.
The shared process helper closes their browsers and removes their profiles on
normal exit, assertion failure and handled interruption. A detached bounded
cleanup retry handles Windows file locks after Chrome exits.

The opening benchmark applies three 15 cm window moves to the Colin fixture,
using the editor's opening synchronisation and the 3D view's floor-update path.
It checks changed wall vertices reaching a display draw, unchanged-floor reuse,
and shader creation while GI updates. It bypasses pointer gestures and the App
history/deferred-state layer. On the development machine, headless Chrome at
950 x 1000 and 0.6 DPR measured 1.40, 1.21 and 1.20 seconds after the changes,
versus about 10 seconds before. No shaders were created during any of the three
moves. These are cutout display timings, not completion of the new GI bake.
The optional `--profile` flag writes a CPU profile; `--assert` enforces a local
1.5-second display budget. The script saves a temporary GI cache to accelerate
subsequent runs. Performance depends on the house, hardware and browser mode.

The `--live` startup regression uses two sealed rooms. It checks capture progress
during navigation, previews after sun/lamp edits, lighting reuse in the unaffected
room, cancellation of unfinished edits, and geometry reuse when moving a lamp.
In the development-machine run, the moved lamp produced its first new preview
about 1.1–1.4 seconds after the edit. This measures an already prepared small scene;
initial house loading and geometry changes still need visibility preparation.
The full Springfield run published 149 live previews, starting about 1.9 seconds
after visibility preparation, and completed the switch and final lighting in
133 seconds. Preview refinement did not materially increase the full-bake time.

The room fixture compares a windowed room against a sealed room, verifies cache
reuse during camera movement, invalidation after a light change, and material
pixel consistency when AO is toggled at zero strength. The local-light variant
checks coloured indoor bounce and isolation from the active-floor light mask.
The open-door variant checks coloured spill into a neighbouring room and a
continuous finish across the semantic room boundary. Unit tests check actual
wall/opening visibility, constant-light continuity near walls, sloping ceiling
occupancy, and the absence of room IDs in diffuse occupancy.
The house check uses the
staged `.viewer-data/public/house.json`, verifies the source house stays unchanged,
captures before/after images, and reports uncapped frame intervals with cached
indirect shading enabled and disabled. Results depend on the GPU, viewport and house.
The editor check loads Colin v2 in React StrictMode with its staged materials,
verifies invisible picking helpers retain transparent shaders, checks exterior
pixels for black overlays, and captures an interior ceiling view.
The GI-only check verifies that clearing the capture-only lamp visibility atlas
does not change the displayed interior, while enabling Light shadows still does.
The updates check verifies that repeated sun changes retain the displayed volume
and reuse worker geometry. The edit check measures how quickly object moves,
new objects, and new wall-attached models reach the rendered scene during GI work.

The live status is available at `scene.userData.indirectLighting` for diagnostics:
generation, completed/total samples, probe/room/reflection counts, capture time and state.

Window and door reveals classify indoor GI from a receiver plane just beyond
their owning wall face. This keeps a reveal from switching lighting at the room
mask boundary. The offset travels with the geometry through clipping and material
batching; exterior reveals keep their outside classification. Irradiance sampling
uses the same receiver plane, preventing interpolation from borrowing light from
the room behind the wall. Direct room-light masks also use this offset. This adds
no texture lookups or bake work.
`node tests/browser/revealLightingRegression.mjs 5180` reproduces the old border
in a constant light field, checks continuity across the header and jamb, and
verifies unchanged exterior lighting and ordinary geometry without the attribute.
It also puts a much brighter field across the wall and verifies that the entire
interior jamb and header sample the owning room.

Saved lighting cache version 2 invalidates bakes made before passive roofs were
included in the room enclosure. This refreshes headroom and occlusion masks after
the roof correction even when the saved project itself has not changed.

Imported interior doors use the fixed frame depth for reveal partitioning. The
open leaf's bounding depth must not enter this calculation: on a thick wall it
can otherwise collapse the bedroom-side reveal and assign the whole jamb to
the hall's lighting side. Door placement remains anchored at the fixed frame.

At concave vertical wall corners, receivers also keep the filtered volume's
footprint beyond the adjoining wall face. A normal bias alone can leave a bright
strip where the tangential texture filter borrows the room behind that face.
Corner planes come from intersecting rendered faces, including unequal wall
thicknesses and roof-clipped fragments, and survive material batching. Convex
corners and freestanding wall ends retain their usual sampling. This uses the
existing baked volume without extra texture reads or cache invalidation.

The Render settings menu includes **GI probes**, disabled by default. These
small spheres use the actual relocated probe positions and captured first-order
RGB irradiance, including directional variation across each sphere. Pending
samples are grey, the active capture is amber, and cyan rims keep dark samples
visible. Solid surfaces occlude the markers, which never intercept picking or
participate in captures, geometry visibility, or cache invalidation. Toggling the
view reuses the current lighting work. The engine status area reports probe
placement, shader preparation, bounce/face progress, readback, volume generation,
reflection progress, navigation pauses and completion. Transient editor activity
keeps priority; lighting status resumes when that activity ends.
