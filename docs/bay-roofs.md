# Bay roofs

In Roof mode, choose **Bay roof**. Select the two mounting points against the
house first, then the outside corners of the bay. An arrow shows the direction
away from the mounting edge. Adjust pitch, eaves overhang, overhang pitch and
soffit colour, then choose **Create**.

The high point is midway between the two mounting points, on their line.
Tiled triangular panels fan out to every exposed outline edge. A rectangular
bay has three panels; an angled bay has additional panels following its corners.
The rear edge stays flush, with overhangs only around the exposed sides.
Wall-centre snap points are expanded to the outside faces of supporting walls
before the eaves are built. This prevents the wall's outer half from projecting
through a sloping overhang. The apex stays on the original mounting midpoint.

The outline must be convex and all outside corners must be on one side of the
mounting edge. Outside corners can be selected in either order. Interior and
collinear snap points do not add extra panels. To change the mounting points,
use Clear and select them again.

Pitch controls the steepest main panel; the other panels share its high point
and a level eave. Overhang pitch controls the common eave drop, keeping the
soffit continuous around corners. The saved outline scales with roof dimensions
and retains its direction when saved and loaded.

**Roof thickness (m)** controls the shell beneath the top surface, as it does for
every other roof type. Existing roofs default to 0.04 m.

Geometry checks: `node --test --experimental-strip-types tests/bayRoof.test.ts`.
Interactive regression scene: `/tests/browser/bayRoofRegression.html` (append
`?angled` for an angled bay, or `?angled&rotation=0.61` for rotated placement).
Select Bay roof, click the two rear wall endpoints followed by the outer corners,
and create the roof. Both views should agree; tile courses should follow the
eaves and the rear should terminate at the wall.
