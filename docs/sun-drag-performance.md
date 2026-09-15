# Sun drag updates

The sun control previews its direction through a ref shared with `SunLight`. The control updates its own knob state, while `SunLight` applies the latest direction to the existing directional light in `useFrame`. Position, colour and intensity are updated together, and unchanged values are skipped. Shadow settings and scene resources remain intact.

Pointer release commits the final direction to project state once. Pointer cancellation clears the preview and restores the saved direction. Losing pointer capture commits the last preview unless the drag has already finished or been cancelled. Project loads and other saved-direction changes use the same light update path.

Do not send preview events through `onLightDirectionChange`: that callback updates the parent editor and can replace scene resources and rebake floor lighting. Baked lighting intentionally refreshes after release.

## Regression check

Load `tests/browser/roofWallRegression.html?materials`, wait for geometry, textures and shaders to settle, then import `tests/browser/sunDragRegression.js` and run `captureSunDrag()`. It exercises 24 pointer moves and checks that the light moves without project commits, geometry/material replacements or lightmap bakes during the drag, followed by exactly one project commit on release. Run `captureSunDrag({ cancel: true })` to verify cancellation restores both saved state and light position. Repeat after enabling Baked lightmaps and allowing its initial bake/shader compilation to finish; bakes should occur only after release.

Before this fix, the control produced 25 project commits for pointer-down plus 24 moves, and changed scene resource identities during the drag. With the fix, the same checks produce zero commits and unchanged resources during movement, followed by one commit on release. Frame timing is also reported, but depends on the viewport, render options and GPU.
