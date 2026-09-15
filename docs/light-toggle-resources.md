# Lighting toggle resource ownership

Pooled point and spot lights retain their scene objects when disabled. Their shadow render targets must be released when the slot becomes inactive, light shadows are disabled, or the light unmounts. `releaseLightShadowResources` disposes both shadow targets, clears their references and marks the shadow for regeneration when enabled again. This preserves the light pool while avoiding retained cube-depth textures for inactive point lights.

Roof infill geometry is owned by `RoofInfillMesh`: geometry inputs are memoized and replaced/unmounted buffers are explicitly disposed. Previously, its parent created new buffer geometries directly in its render loop, so unrelated lighting changes leaked the old GPU buffers.

Shader warm-up compiles materials without altering live object culling. The installed Three renderer traverses materials directly during compilation, independently of frustum culling. Temporarily turning off culling was unnecessary and also caused the imported-model batcher to recreate batches for the temporary policy.

## Verification

The original Red House toggle cycle increased GPU geometry allocations from 258 to 339 and retained three 1024-pixel point-light shadow cube targets after switch-off. The test browser recovered its frame rate even before the changes, so the user's persistent slowdown was not reproduced exactly; these resource problems were directly observed.

After the fixes, repeated full lighting/shadow cycles returned to 346 draw calls, 185 geometries and 20 textures. Inactive shadow targets were absent, and active shaders and culling settings matched the initial state. Six rapid on/off cycles also left resource counts unchanged. One measured repeated cycle returned to a median frame interval of 17 ms; timings depend on hardware and other activity.

Run `checkLightToggleRecovery()` from `tests/browser/lightToggleRegression.js` in the roof-wall browser harness, with the ground floor active so Red House's three point lights are included. The check asserts resource, draw-count, shader and culling recovery. The shadow-resource unit test checks disposal and repeated allocation/cleanup. Roof-junction finish, model-batching and sun-drag checks cover the adjacent renderer paths.
