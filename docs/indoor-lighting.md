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
The atlas allocates space for the actual lamps rather than all diffuse probe slots.
Probe layout, world-space triangle expansion, BVH construction, ceiling occupancy,
and lamp visibility maps build in a dedicated Web Worker. They become available
only after the worker has completed the cache. No CPU bake runs in React render
or an editor frame callback.
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
A previous 4 cm tolerance accepted samples inside thin partitions and allowed
neighbouring-room light to bleed into the filtered volume.
Ceiling-border voxels extend the interior light below the actual ceiling rather
than sampling the attic. Exterior receivers still fail the occupancy test.
The second bounce reads
the completed first-bounce volume, never partially updated probe coefficients.
Completed bakes also retain first-pass coefficients for incremental updates.
Adding, removing, moving or resizing a wall window/door selects the affected
room zones, zones with a view of the opening, and visible neighbouring zones
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
Responsive frames submit up to six faces within a 3 ms CPU submission budget;
frames slower than 35 FPS submit one face. First-order RGB spherical harmonics
are integrated on the GPU into four half-float pixels, followed by one asynchronous
readback per probe. This replaces six sequential full-face readbacks and CPU
integration. On startup, probes nearest the initial camera
are captured first. Preview volumes are published after 8, 32, 128 and 512 probes
when the first pass is larger than those batches. Uncaptured probes do not count
as black illumination; captured dark probes retain valid support. Previews are
displayed immediately, while first-bounce captures remain direct-only until the
complete first-pass volume is available. The editor's GI indicator distinguishes
preparation, building, refinement, navigation pauses and completion. The grid
captures direct scene light and sky visibility, followed by an indirect pass
for diffuse colour bounce. Named glass materials transmit light during capture.
Camera-dependent wall/roof fades and selection decorations do not alter the bake.
Invisible editor picking surfaces are excluded from captures. Captures preserve
each live material's transparency flag to prevent baking an opaque shader into
zero-opacity wall, floor or ceiling helpers. Faded solid materials temporarily
write depth during capture so farther faces cannot overwrite them. Their live
opacity, visibility and depth-write settings are restored after every face.
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
uses the renderer's direct-light path and existing room mask; explicit local
shadows are controlled by **Light shadows**. GI never adds a second visible
direct-shadow test. Capture work is bounded to four cache references and at
most eight candidate triangles per lamp.
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
Captures pause during active canvas input, model transforms, camera
movement, scene preparation and XR presentation. Updates wait for 600 ms of
edit inactivity; repeated edits cancel obsolete worker preparation. GPU capture
shader variants are prepared asynchronously and retained for reuse before their
first render. Lighting hooks are attached before scene shader warmup. Composed
shader keys recognize inherited hooks anywhere in the key, and wall fade
materials survive navigation so approaching the same wall reuses its GPU program.
GPU capture and readback still belong to the renderer thread.
Project changes never await worker preparation or volume generation.
Menu hover no longer pauses captures. The volume worker indexes nearby probes
spatially and caches compact probe-to-voxel visibility weights. Subsequent
previews, bounce passes and sun changes reuse those weights; coefficients are
decoded once per volume update rather than once per voxel contribution.
The shared direct-light room mask also rasterizes in a worker and is keyed to
room polygons and bounds, so furniture edits reuse it.
Sun-only changes reuse the prepared geometry and lamp visibility. The last
completed irradiance volume and reflections remain displayed while replacement
lighting is captured; a replacement volume is published only when complete.
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
node tests/browser/lightingStartupRegression.mjs
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14 --probes
node tests/browser/lightingStartupRegression.mjs 5180 lighting-startup --cache
node tests/browser/savedLightingProjectRegression.mjs
node tests/browser/lightingStartupRegression.mjs 5180 springfield-14 --cache
node tests/browser/indirectLightingRegression.mjs --house
node tests/browser/indirectLightingRegression.mjs --editor
node tests/browser/indirectLightingRegression.mjs --editor --artefacts --tag=check
node tests/browser/indirectLightingRegression.mjs --editor --corners --fast-bake --gi-only
node tests/browser/indirectLightingRegression.mjs --strict --updates
node tests/browser/indirectLightingRegression.mjs --editor --fast-bake --small --edit-performance
```

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
