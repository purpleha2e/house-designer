# Slab facade finishes

Structural slabs and the exterior finish on their edges have different responsibilities. The slab footprint, openings and roof cutouts define the solid floor. The exposed edge finish belongs to the facade beside it.

The former renderer picked a supporting wall and then used its last material assignment for an entire slab edge. That failed when a wall had several independently painted regions, or when only part of a long wall touched a roof.

Slab edge finishes now use the completed wall geometry from the same view. The edge is split where lower and upper wall faces meet it, and each segment inherits only its matching wall fragment or whole-wall assignment. Lower wall finishes take precedence, followed by the upper wall. Texture coordinates remain in the supporting wall's frame. This does not require rebuilding wall geometry when a material changes.

The geometry store is scoped to the view; it publishes completed worker results and protects newer results from stale cleanup. Structural caps and roof cutouts retain their existing geometry. A larger unification of slab solids, ceiling finishes and opening reveals is still possible, but it is separate from facade finish ownership.

`slabFacadeSegments.test.ts` covers material boundaries, missing support, roof cuts and store lifetime. `tests/browser/facadeCornerRegression.js` checks normal selection, Shift-selection around the corner, and painting the matching slab edge without recolouring another edge.
