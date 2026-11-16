# Mobile house tours

Published Springfield tour: https://www.pitchr.me/house-designer/springfield/

The viewer is a separate, read-only 3D app with touch controls. Build it from a
saved project file; it does not read unsaved changes in the editor.

GI is enabled by default and uses the completed lighting cache in the saved house.
Tours automatically use the saved GI format, including second-order lighting;
the mobile link does not need the editor's experimental `giSH` URL flag.
Exterior sky occlusion is also on by default, at 75% strength, in both the editor
and tours. It prepares its sky/eave shading on load and reuses it while navigating;
it is not stored in the saved GI cache. Exterior sky occlusion applies in daylight.

1. In the editor's **3D floors** dropdown, choose **All floors**. Wait for the
   lighting status to say **ready to save with model**.
2. Use **Project menu → Save to device** and save the house JSON in this repository.
3. From the repository directory, build the tour, substituting your saved filename:

   ```powershell
   npm run build:viewer -- --project "springfield_14.json" --title "Springfield"
   ```

4. Upload the contents of `dist-viewer/` to a folder on your static website, then
   open that folder's URL on your phone. Include all generated files and asset
   folders. The build command creates local files; it does not publish them.

On mobile, use the left joystick to move and drag the right side to look.
**Render quality → Auto** lowers drawing resolution if movement stays below
28 FPS, then restores sharpness gradually with sustained headroom. It ignores
startup and idle time and keeps GI and exterior occlusion enabled. Choose
**Full resolution** to disable this adjustment. This reduces pixel rendering
cost; it does not guarantee a particular frame rate on every device.
The tour menu includes Walk/Fly mode, Upstairs/Downstairs, Reset view and
fullscreen controls. On iPhone, the viewer's fullscreen help describes using
Safari's **Share → Add to Home Screen**.

For a desktop preview:

```powershell
npm run dev:viewer -- --project "springfield_14.json" --title "Springfield"
```

This preview listens on `127.0.0.1:5183` on the development computer. Use the
published website URL for mobile access. If lighting is unfinished, the builder
explains how to save a current cache; `--allow-unbaked` is available for development
previews only.

`npm run publish:colin` is specific to `colin_house_v2.json` and Colin's existing
website destination. Use the generic build command above for Springfield or
other houses.

The current Springfield save retains an undefined reference to its replaced
staircase. For this file, append
`--retired-model portal-model-f08c2cc3a2f93b9ef8c23d1ea5f3b036` to the build command.
This keeps that obsolete model absent, retains the replacement stairs and preserves
the saved GI identity. The builder refuses this option for models that still have
a definition in the saved house.
