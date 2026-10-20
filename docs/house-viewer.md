# Read-only house tours

The house viewer is a separate 3D-only entry point. It uses the designer's renderer,
but does not mount the editor, its project controls, its property panels, or its
selection and transform tools. The same viewer works for every house; a client's
name is only the title and destination folder of that client's published package.

## Controls

- **Xbox controller:** connect by USB or Bluetooth, click the view, then press a
  controller button. Left stick moves forwards/backwards and sideways; right
  stick looks around. Gentle stick movement gives slower movement, with a dead
  zone to prevent drift. Uses the current Walk/Fly mode and also works in the
  designer's 3D view. Input pauses outside the focused page, while typing or
  transforming an object, and during VR. Requires a browser-standard controller
  mapping; HTTPS or localhost is recommended for browser gamepad access.
- **Walk:** W/S forwards/backwards, A/D sideways, left-button drag to look.
  The camera stays 1.8 metres above the selected floor, including when standing
  still or switching back from Fly. Walking is free camera movement at a fixed
  height, without wall collision or automatic stair climbing.
- **Fly:** the same controls, following the camera's full direction. Q/E move
  straight down/up. Hold Shift in either mode to move faster.
- **Stairs:** clickable buttons at the lower and upper landings move to the
  opposite landing on the adjacent floor. Toolbar Upstairs/Downstairs controls
  also work when a saved house does not yet contain a staircase model.
- **Reset view:** returns to the starting floor and viewpoint. Tours start
  outside the house rather than inheriting an arbitrary editor camera position.
- **VR:** the existing WebXR button enters VR on a supported headset/browser.
  Controller movement, snap turns, and VR stair buttons are retained. A hosted
  tour must use HTTPS for headset access. Desktop controls pause during VR.

The toolbar also offers Normal, Wide and Super-wide aspect controls. Elevation
drawing downloads are future work.

The bottom-right corner shows the FPS measured while moving, retaining the last reading when stationary. All storeys stay loaded;
changing floors moves the viewpoint without restarting storey preparation.
Prepared scene copies retain camera-hidden floor/ceiling surfaces and update
their visibility immediately when the viewpoint crosses to another storey.
Once the tour is ready, an unchanged view submits no display draws; navigation,
lighting changes, resizing and VR still render normally.

On devices whose primary pointer is touch, the tour uses one drawing-buffer
pixel per CSS pixel and skips screen-space ambient occlusion. Saved indirect
lighting, room reflections, sun shadows and transparent glass remain enabled.
This avoids AO's extra geometry/transparency passes returning after a floor
change, increasing sustained phone rendering cost. Desktop tours and the editor
retain their usual AO settings; this display choice does not change the bake.

## Preview any saved house

For a client tour, first show **all floors** in the editor and let GI finish.
When the engine status says **ready to save with model**, use **Save**. The
project includes a compressed, versioned lighting volume, probe data and room
reflections. The viewer loads that lighting directly without probe captures,
visibility raycasts or a GI worker. House assets and ordinary renderer preparation
still load normally. Older projects need to be opened and saved again after
their lighting completes.

From the repository root (Node 24 or later):

```powershell
npm run dev:viewer -- --project colin_house_v2.json --title Colin
```

Open `http://127.0.0.1:5183/`. Use `--port` to select a different port. Save the
current editor project first if you want the tour to include your latest edits.
The preview reads the saved snapshot and has no save or edit commands.

## Build any house for publishing

```powershell
npm run build:viewer -- --project colin_house_v2.json --title Colin
```

Replace the project filename and title for each client. This generates
`dist-viewer/`, containing the viewer, `house.json`, the built-in models used by
that house, and the uploaded materials/models it references. The build reads
local `manufacturer-assets/**/metadata.json` to resolve uploaded assets; it does
not need the running portal or publish its accounts database. Missing assets
fail the build instead of silently publishing an incomplete house.

Materials created in the in-app **Material editor** travel inside the saved
house as `materialDefinitions`. The tour builder converts their embedded image
data to KTX2 delivery textures, preserving saved-lighting identity through
source-image hashes. These materials need neither the browser's local library
nor the manufacturer-assets folder on the publishing machine.

The build also rejects missing, stale or damaged GI caches. Changes to geometry,
sun position, material assignments or lighting settings require a new editor
bake. For development previews only, add `--allow-unbaked` to permit the old
runtime-baking path. A tour containing a saved cache never silently starts a
replacement bake on a client's machine if that cache fails validation.

Generated staging files live in `.viewer-data/`; both it and `dist-viewer/` are
ignored by this repository. The source project is never changed by a viewer build.

## Publish alongside the existing website

Copy the **contents** of `dist-viewer/` into the website's published folder for
that house. For a GitHub Pages website whose source is `docs/`, the layout is:

```text
docs/
  index.html                     existing website
  privacy-policy.html            existing page
  house-designer/
    colin/
      index.html                 viewer entry
      house.json                 Colin's published snapshot
      assets/                    viewer code, workers, built-in models, texture decoder
      published-assets/          uploaded assets used in this house
      .nojekyll
    another-client/
      ...                        another independently built house
```

Commit the new house folder in the **website repository**, then let its existing
Pages deployment publish it. Do not replace the whole website with the viewer
build. Its relative asset URLs support any destination folder, such as
`https://www.pitchr.me/house-designer/colin/` or
`https://www.pitchr.me/house-designer/another-client/`.

Keep a `.nojekyll` file at the website's publishing root if it serves raw static
files without Jekyll. The per-house file is also included in each package.

No client name or website hostname is encoded in the runtime.
Publishing another snapshot to the same folder updates that
house's link. Publishing to a new folder creates another tour.

### Current Colin hosting

The corner hamburger opens the tour controls, title and navigation help,
including Normal, Wide and Super-wide aspect controls. The closed menu occupies
only a 44-pixel button. Green text at the bottom left reports scene preparation,
asset and lighting work, then Scene ready, without a background console strip.
The scene follows the visible viewport on startup, full-screen changes and
rotation; iPhone Home Screen mode draws behind the system status area.

Colin's tour is published at `https://www.pitchr.me/house-designer/colin/`.

On phones and tablets, use the bottom-left joystick to walk forwards/backwards
or sideways. Drag the right half of the scene with a second finger to look
around at the same time. Releasing the joystick stops movement; leaving the
page or rotating the device also clears input. The corner **hamburger menu** contains
Walk/Fly, floor navigation, Reset view and aspect controls. In Fly mode the
joystick follows the direction you are looking. Desktop keyboard, mouse,
Xbox and supported headset controls remain available.

Choose **Full screen** in the hamburger menu to fill the display on
supported browsers; use **Exit full screen** or Escape to leave. All touch
controls stay inside the full-screen view. If iPhone Safari cannot enter full
screen, the button explains **Share → Add to Home Screen**. Keep **Open as Web
App** enabled if offered, then launch that icon to open without Safari’s toolbars.
The generated manifest uses relative URLs so each house opens its own tour.

Published tours use the saved floor geometry directly when they contain baked
lighting. They do not recalculate window openings before validating that cache,
avoiding changes to exact numeric cache keys on different browser engines.
If saved lighting cannot be restored, the bottom status reports the specific
validation or loading error instead of just “Indirect lighting unavailable”.
The live website repository is **`purpleha2e/pitchr_privacy_policy`**, with
GitHub Pages publishing the **root of `main`**. It is separate from the
`cuplup` application repository. The website root contains `.nojekyll`.

To update Colin's tour, rebuild `colin_house_v2.json` using the command above,
then publish the contents of `dist-viewer/` to `house-designer/colin/` in that
website repository. Commit only the tour update and push to `main`; wait for
the Pages deployment and verify the public URL. Keep the website's other
pages and `CNAME` unchanged. The tour is a static saved snapshot, so the
designer computer and asset portal do not need to remain running.

### Updating Colin after editing the house

1. In the editor, show **all floors**, wait for **ready to save with model**,
   then save `colin_house_v2.json` in the source repository. New windows change
   the lighting, so wait for the new lighting calculation before saving.
2. Double-click **`publish-colin.cmd`** in the source repository, or run:

   ```powershell
   npm run publish:colin
   ```

   The script checks and builds the model, updates (or creates) the website
   checkout in `node_modules/.cache/pitchr-site`, copies the tour, commits it
   and pushes to the website's `main` branch. It needs Node 24+, Git and access
   to the private GitHub website repository. It does not commit the House
   Designer source or push to GitLab.

   Failed builds stop before copying or publishing. Local changes, an
   unexpected remote/branch, or unpublished website commits also stop the
   script with an explanation. An unchanged build creates no extra commit.
   If a push fails, the script prints the command to retry that saved commit.
   The double-click window stays open so you can read the result.

   For a local preview without publishing, use
   `npm run dev:viewer -- --project colin_house_v2.json --title Colin`.
3. Allow GitHub Pages to deploy, then refresh
   `https://www.pitchr.me/house-designer/colin/`. Colin uses this same link after
   every update. Saving the model or pushing the House Designer source to
   GitLab alone does not publish a new tour.

GitHub Pages may cache the entry page for ten minutes. The script prints an
update link with `?v=...` so you can open the new page after deployment without
reusing an older cached page. Colin can keep his usual bookmark; Ctrl+F5 also
forces his browser to recheck it. Each build now gives the model a filename
based on its contents and embeds that filename in the viewer, so a new viewer
cannot accidentally load the previous model from the browser cache. The build
prints the exact source file and snapshot filename for troubleshooting.

The package is for HTTP/HTTPS hosting. It is not a single HTML file that can be
double-clicked offline; a portable offline download can be added separately.

## Validation

```powershell
node --test --experimental-strip-types tests/viewerNavigation.test.ts
npm run dev -- --host 127.0.0.1 --port 5180
# In a second terminal, after building a viewer:
node tests/browser/readOnlyViewerRegression.mjs
# Saved-house phone rendering through repeated floor changes (requires built viewer):
node tests/browser/readOnlyViewerRegression.mjs --rendering-only
```

The browser regression checks navigation, real mouse look and stair clicks,
read-only controls, input cleanup, and a compiled tour served from a different
nested URL without the portal. Actual VR presentation still needs testing on
a physical headset.
