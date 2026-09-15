# Wall render batching

Wall rendering groups faces by their resolved finish, independently of the face identities used for picking and painting. `WallEngineMesh` resolves the existing fragment, side and cap assignment rules before passing a material batch key to `buildWallBufferGeometryPayload`. The key contains the material ID, custom colour, texture scale, texture rotation and fallback wall kind. Assignment IDs, targets and coverage do not belong in this key: their effect has already been resolved for each face.

Each render batch uses a representative source to create its material. All original triangles, normals and UVs remain intact. Editing a finish rebuilds the render groups, splitting or merging batches as needed. The separate face pick payload retains the original selection identities; render batches deliberately have no pick targets.

## Red House comparison

One captured frame of `red_house_3.json` in `tests/browser/roofWallRegression.html?materials` produced:

| Measurement | Before | After |
| --- | ---: | ---: |
| Ground-floor wall groups | 295 | 5 |
| First-floor wall groups | 137 | 4 |
| Wall calls, main pass | 432 | 9 |
| Wall calls, shadow pass | 432 | 9 |
| Total frame draw calls | 1,460 | 614 |
| Wall triangles | 2,788 | 2,788 |

The total reduction was about 58% for that view. Counts vary with the camera and render settings. The sorted triangle/finish fingerprint was identical before and after, including positions, normals, UVs and texture settings.

`tests/wallMaterialBatching.test.ts` checks finish identity, vertex preservation, separate picking and batch changes after editing. The browser regressions cover roof regions, both sides of the doorway, door reveals and facade corner selection in Red House and the smaller roof test project.

For a before/after comparison, import `tests/browser/wallBatchingRegression.js` in the browser harness. Before enabling batching, save `JSON.stringify(captureWallBatching())` under the session storage key `wall-batching-baseline`. With batching enabled, call `checkWallBatching()` after the same view and assets have settled. It compares triangle/finish fingerprints and measures actual main and shadow draw calls.
