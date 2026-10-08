# Read-only house tours

The house viewer is a separate 3D-only entry point. It uses the designer's renderer,
but does not mount the editor, its project controls, its property panels, or its
selection and transform tools. The same viewer works for every house; a client's
name is only the title and destination folder of that client's published package.

## Controls

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

Limited render controls and elevation drawing downloads are future work.

## Preview any saved house

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

Colin's URL is an example only; no client name or website hostname is encoded
in the runtime. Publishing another snapshot to the same folder updates that
house's link. Publishing to a new folder creates another tour.

The package is for HTTP/HTTPS hosting. It is not a single HTML file that can be
double-clicked offline; a portable offline download can be added separately.

## Validation

```powershell
node --test --experimental-strip-types tests/viewerNavigation.test.ts
npm run dev -- --host 127.0.0.1 --port 5180
# In a second terminal, after building a viewer:
node tests/browser/readOnlyViewerRegression.mjs
```

The browser regression checks navigation, real mouse look and stair clicks,
read-only controls, input cleanup, and a compiled tour served from a different
nested URL without the portal. Actual VR presentation still needs testing on
a physical headset.
