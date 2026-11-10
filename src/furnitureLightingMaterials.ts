import type { Material } from 'three'

// A temporary preview replaces a mesh's material, but its original must keep
// its GI hook while a background scene scan runs, ready for immediate restore.
export const furnitureLightingSources = new WeakMap<Material, Material>()
