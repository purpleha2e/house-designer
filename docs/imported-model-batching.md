# Repeated door and window rendering

`ImportedModelBatching` shares render submissions for repeated opaque parts of imported wall-mounted models. The original GLTF hierarchy remains in place for bounds, collision, selection and transform controls. Its batched leaf meshes are hidden from ordinary rendering; colour picking treats those originals as selectable and temporarily hides the render batches. Geometry picking continues to raycast the original model objects.

Batches require the same geometry and material objects, shadow settings, layer mask, render order and culling policy. Transparent glass, transmitting materials, skinned or morphing meshes, custom shadow materials and sheared transforms retain ordinary rendering. This preserves glass sorting and avoids changing normals for unsupported instance transforms. Single members also retain ordinary rendering.

Mirrored placements use a separate batch with a common reflection on the batch mesh and positive determinants in its instance matrices. This preserves winding as well as world placement. Frame updates read the existing model hierarchy, so resizing, flipping, movement and live transform controls remain authoritative. Instance buffers and bounding spheres update only when transforms or counts change. Unregistering models restores source visibility and disposes instance resources without disposing shared GLTF geometry or materials.

## Validation

In one saved Red House view, toggling the same scene between ordinary and instanced rendering gave:

| Measurement | Ordinary | Instanced |
| --- | ---: | ---: |
| Main-pass calls | 449 | 277 |
| Shadow calls | 157 | 69 |
| Total calls | 606 | 346 |

203 opaque source meshes were represented by 25 batches. This was approximately a 43% reduction in total calls for that view. Counts vary with camera and visibility; grouped culling may submit some instances that individual mesh culling would skip.

The maximum instance transform error was below 0.000001 world units. The same-frame image comparison had a mean RGB channel error below 0.0002 on the 0–255 scale, with fewer than 0.0005% of pixels differing by more than eight channel values. Geometry and material objects themselves are shared without modification.

`tests/importedModelBatching.test.ts` covers transforms, mirrored winding, unchanged-frame buffer uploads, original ray targets, glass/shear fallbacks, shadow separation, visibility, removal and resource ownership. `tests/browser/modelBatchingRegression.js` compares ordinary and batched frames, checks actual individual door/window clicks, and exercises mirroring, resizing, moving and removing doors. Run its checks in `roofWallRegression.html?materials` after geometry and shader preparation has settled. The sun-drag and roof-junction material regressions also pass with model batching enabled.
