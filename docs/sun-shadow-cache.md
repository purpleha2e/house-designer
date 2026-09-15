# Sun shadow caching

The directional sun light uses `shadow.autoUpdate = false`. `SunShadowCache` checks the actual shadow-casting scene immediately before the directional shadow pass, after world transforms, instance matrices and sun-only blockers have been updated. It requests a fresh map when the sun/target, shadow projection/settings, caster membership, visibility, transforms, geometry buffers or shadow-relevant material state changes. Camera position and orientation are not inputs; camera layer changes are.

The snapshot includes instance-buffer versions, morph weights and skeletal matrices. Unchanged instance transforms therefore reuse both their GPU buffers and the sun map. Async wall/roof geometry replacements are detected by their actual geometry objects, without depending on a project revision arriving at the same time as a worker result.

Point and spot shadows keep their existing update behaviour. Colour picking temporarily disables shadow rendering and restores the previous setting afterward; its temporary materials and visibility must never overwrite the cached lighting map.

## Validation

In the Red House test view, a forced fresh sun map cost 69 shadow draw calls, for 346 total calls. An unchanged frame costs 277 calls, approximately 20% fewer. Cached images were pixel-identical to fresh maps after camera movement, caster visibility changes and instance movement. Sun dragging refreshed 26 frames during the regression and returned to zero sun-shadow calls after settling. Async roof edits also refreshed the map, and their settled cached image matched a forced fresh map exactly.

`tests/sunShadowCache.test.ts` covers the invalidation inputs. `tests/browser/sunShadowCacheRegression.js` checks draw counts, cached-versus-fresh pixels, camera reuse, instance/visibility edits and continuous refresh during sun dragging. Run in the Red House roof-wall browser harness with daylight and sun shadows enabled, after assets and shaders settle. Existing model-picking and light-toggle recovery checks verify pick-pass isolation and independent local-light behaviour.
