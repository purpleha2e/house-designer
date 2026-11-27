# Asset Portal

The separate Node.js account/private-workspace service is described in
[Accounts and workspaces](../docs/accounts-and-workspaces.md). `npm run dev:all`
starts both services and the editor. Its local development accounts are separate
from manufacturer portal accounts.

Use **Project menu → Material browser** to organise personal materials and
preview read-only public materials. **Save as my copy** makes a personal material
you can edit. Personal materials are stored in the browser and their images
travel with houses that use them.

Sign in as an administrator under **Project menu → Assets** to see
**Public Materials** in the project menu. There you can create and publish new
materials, import a `.material.json` file with **Import & publish**, create, rename
or move folders, delete empty folders, and move, remove or restore public
materials. Removing a material preserves its finish in houses that already use it.
Select an existing material in **Public Materials**, edit its details, surface
settings or texture maps, and choose **Save changes**. The material keeps its ID
and folder, so houses that use it pick up the saved finish.
Select a folder in the catalogue tree to set the destination for **New folder**,
new materials and imported materials. Publishing shows the current destination.
When publishing, choose existing catalogue labels or enter new ones. Collection
suggestions follow the selected brand.

Local development server for manufacturer/admin asset uploads.

Run both the React app and upload API:

```powershell
npm run dev:all
```

Or run them separately:

```powershell
npm run dev:portal
npm run dev
```

The server stores uploaded originals and metadata in `manufacturer-assets/`, which is intentionally ignored by git.

Use **Object browser → Manage public catalogue** to move objects between folders or
remove them from the browser. Removal preserves models already placed in houses.
Use **Upload public model** for new GLB assets. Manufacturer uploads are drafts
until an administrator publishes them in the portal.

Set `ASSET_PORTAL_ADMIN_PASSWORD` on the portal server before exposing it to users.
It sets the initial admin password and replaces an existing default password.
The development account below is available locally. Production mode rejects its
default password.

```text
admin@housedesigner.local / admin
```

## Material Processing

Material image uploads are converted server-side by the local asset portal:

- Keep the original upload.
- Resize only when a source dimension is greater than 2048.
- Convert base color maps to KTX2 ETC1S.
- Convert normal maps to KTX2 UASTC.
- Convert roughness, metalness, and ambient occlusion maps to KTX2 ETC1S.
- Keep displacement optional and capped lower for VR.
- Store converted textures in the asset's `processed/` folder.
- Prefer processed KTX2 files in the runtime material catalog, falling back to originals while conversion is queued or if it fails.

Uploads return immediately and queue conversion in the background. The Process button can be used to retry an existing material; already generated KTX2 files are reused.

## Processing Plan

GLB uploads that already contain textures should not be treated as opaque binaries forever. The processing job should:

- Unpack/inspect the GLB with `gltf-transform`.
- Resize and convert embedded textures to KTX2.
- Rebuild an optimized GLB using `KHR_texture_basisu`.
- Preserve the original GLB for future reprocessing.
