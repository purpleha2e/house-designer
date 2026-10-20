# Bay roofs

In Roof mode, choose **Bay roof**. Select the two mounting points against the
house first, then the outside corners of the bay. An arrow shows the direction
away from the mounting edge. Adjust pitch, eaves overhang, overhang pitch and
soffit colour, then choose **Create**.

Create selects the new roof and opens its own settings. Subsequent pitch and
style changes edit that roof. Use **Roof tools** again to create another roof.
The blue overlay marks the selected roof; deselect it to see its normal finish.

Under **Shape**, choose **Bay roof style**:

- **Fan** is the existing mode. Panels fan out from the central ridge towards
  each exposed outline edge. **Ridge length** extends that ridge from the
  mounting midpoint towards the front; zero gives a pointed roof.
- **Classic Bay Lean To** creates a broad front slope with hips running straight
  back from the front corners to the mounting wall. Canted sides have their own
  pitched panels. Pitch sets the front slope. Ridge length is hidden in this
  mode, but its Fan value is retained when switching back. On irregular outlines,
  the furthest front-facing edge defines the front slope; rear hip ends remain
  within the mounting edge.

Both styles are available while placing a roof and when editing an existing one.
The style is saved with the model; older projects keep Fan automatically.
The rear edge stays flush, with overhangs only around the exposed sides.
Wall-centre snap points are expanded to the outside faces of supporting walls
before the eaves are built. This prevents the wall's outer half from projecting
through a sloping overhang. In Fan mode the ridge starts at the original mounting midpoint.

The outline must be convex and all outside corners must be on one side of the
mounting edge. Outside corners can be selected in either order. Interior and
collinear snap points do not add extra panels. To change the mounting points,
use Clear and select them again.

In Fan mode, pitch controls the steepest main panel; the other panels share its
high point and a level eave. Overhang pitch controls the common eave drop, keeping the
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
