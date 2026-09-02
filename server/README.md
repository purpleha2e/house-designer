# Asset Portal

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

Default House Designer admin:

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
