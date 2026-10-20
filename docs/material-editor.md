# Local material editor

Open **Material editor** from the designer's project menu, or **Open material
editor** in the Materials panel. No portal or account is required.

Create a material, add PNG/JPEG/WebP maps and adjust its colour, roughness,
metalness, normal strength, real-world tile dimensions and rotation. Sphere,
tile and room-corner previews support orbit/zoom and three lighting presets.
The preview lighting does not change the house lighting. Height maps affect
only surfaces with displacement enabled; some house surfaces and VR omit them.

## Material folders

The left library is a searchable folder hierarchy, shared with the designer's
**Materials** picker. **My materials** contains personal folders; **Catalogue**
groups built-in/manufacturer materials by type, manufacturer and collection.
The material editor no longer asks for a category.

Selecting an object shows a compact, scrolling context panel at the top right
of the 2D view. Objects with material slots show the current finish and a swatch
for each part, including the authored stair finishes. Click a finish to open
the searchable material hierarchy. **Use original finish** removes that slot's
override. Object dimensions, scale and rotation are in the same panel.

Select a folder and choose **New folder** to create a child, or enter a path
such as `Metals/Chrome`. **New material** starts in the selected folder. To move
the open material, select a destination and choose **Move current material
here**, or drag its library row onto a folder, then save. Dragging another
saved material changes its browser working copy immediately. Update its device
file with **Save to device** when that file should retain the new location.

Folder paths travel inside material and house files. Opening a file rebuilds
its folder path even on a different device. Empty folders are kept in the local
browser library. Existing materials without a folder remain at the library
root. Moving a material between folders does not invalidate its saved lighting.

Images are decoded, resized to at most 2048 pixels and encoded in a background
worker. All map data stays on the device. **Save to device** writes a portable
`.material.json` file containing the settings and editable image data. Supported
browsers offer a native Save dialog; others download the file. It also keeps a
working copy in IndexedDB. **Keep in browser** saves only the working copy for
the current browser and origin. Neither action publishes anything or sends
files to the manufacturer portal. Materials appear under **My materials**
in the designer's material selector. The house renderer pauses while the
material editor covers it, leaving the GPU available for the live preview.

Use **Import material file** to reopen a device file or bring it to another
device. Clearing browser data removes the working library, but leaves device
files intact; a different browser or origin has its own working library.

Saving a house includes `materialDefinitions` for the local materials actually
referenced by surfaces, roofs or model overrides. Definitions embed the image
data rather than temporary blob URLs. Loading the house registers those
definitions and copies them into the local library. Definitions in the opened
house take precedence over an older library copy.

The normal viewer build/publish workflow converts these materials to KTX2,
using ETC1S for colour/scalar maps and UASTC for normals, and bundles only those
delivery textures. Editable PNG/JPEG/WebP data remains in the material and house
files. Source-image hashes preserve the saved lighting identity across this
conversion; a changed or missing hash fails publication rather than using an
unverified cache. Converted textures are cached by source hash and map type.
The resulting tour needs neither the creator's local library
nor a portal server to display them. A build fails if a referenced local
material definition is missing. Each published snapshot contains the material
values saved with that house; later edits to the local library do not alter
already-published tours.

This is local-first authoring. Cloud sync, community publication and local model
authoring are separate future features.
