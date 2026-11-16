JUNIPER — COMPACT CABIN BED

Main file: junior-cabin-bed-spindles-left-v2.glb
Editable companion: junior-cabin-bed-spindles-left-v2.blend
Preview: junior-cabin-bed-spindles-left-v2-preview.png
Additional views: junior-cabin-bed-spindles-left-v2-front.png / junior-cabin-bed-spindles-left-v2-rear.png
Exact measured bounds: junior-cabin-bed-spindles-left-v2-dimensions.json

DIMENSIONS
All GLB coordinates are metres. Import at scale 1.

Frame length:                 191 cm
Maximum available wall:       192 cm (only 1 cm total nominal spare length)
Frame width, without ladder:   85 cm
Overall depth with ladder:    114.3 cm
Platform height:               80 cm
Mattress:                     190 x 75 x 12 cm
Top of mattress:               92 cm
Overall guardrail height:     114 cm
Guard above mattress:          22 cm
Ladder access opening:         38 cm
Hanging rail from floor:       68 cm
Storage compartment floor:      5.5 cm
Rail-to-compartment-floor:     62.5 cm
Hanging bay clear width:       approximately 95 cm

The three drawers are on the right; the open hanging bay and side-mounted
ladder are on the left. All four upper barriers have rounded vertical
spindles between top and bottom rails. The entry opening is on the left. The ladder does not increase the overall length.
Allow additional room in front for standing, ladder access and opening drawers.
The hanging bay is for short garments and trousers folded over hangers, not
full-length adult clothing. Illustrative hangers are included.

The main end supports sit below the mattress. The upper end panels sit above
its sleeping surface and within its length, rather than extending beyond it.
This is why the model can include a true 190 cm mattress in a 191 cm envelope.
It is not a conventional timber mattress box with thick boards at both ends.
Confirm the real mattress, wall straightness, skirting and fitting tolerances
before treating the nominal dimensions as a physical installation specification.

MATERIALS AND IMPORT
Exactly six materials, with one corresponding mesh per material:
01 Frame: structure, guards, cabinet carcass, drawer boxes, rail and hangers.
02 Ladder: stringers, steps and integral tread ribs.
03 Drawer fronts: all three fronts, including the edges of the finger pulls.
04 Mattress: mattress and its seam detail.
05 Pillow: pillow and stitched edge.
06 Quilt: quilt and folded-back top edge.

Every mesh has UV0 coordinates and normals. The hard parts use a consistent
50 cm local texture repeat. Bedding has UV layouts for fabric textures.
Six neutral PBR materials are supplied without bitmap textures, so there are
no external texture files or required glTF extensions. The supplied colours
are editable; set the base colour to white if you want an applied texture's
original colours without the existing tint.

The GLB is Y-up, with the long axis along X, ladder/front at +Z and pillow
at +X, opposite the left-hand ladder. The ground is Y=0. The Blender companion uses Blender's normal Z-up
coordinates. The model is static; drawers are closed and not animated.
Studio lights, camera and ground in the preview images are not in the GLB.

USE OF THIS CONCEPT
This is a dimensioned visual/design asset, not a manufacturing drawing or
a tested/certified children's bed. It does not specify joinery, fasteners,
structural loads or safety-test results. A bed maker must review the design,
guard openings, mattress retention and access before any physical build.

For the intended five-year-old: a raised sleeping platform at this height
should be treated as a future-use concept. High beds generally carry a
warning against use by children under six. Do not interpret the guardrails
shown in the model as certification that this design is suitable at age five.
Source: https://www.flairbeds.co.uk/trade-guides/bunk-bed-safety-bs-en-747

SOURCE
Rebuild geometry: node scripts/generate-junior-cabin-bed.mjs
Import, validate and render: scripts/render-junior-cabin-bed.py (Blender)
