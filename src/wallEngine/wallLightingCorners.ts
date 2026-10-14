import type { WallMeshFace } from './wallMesh.ts'

/** Inward half-planes at concave vertical edges. Open and convex edges have none. */
export function wallLightingCornerPlanes(faces: WallMeshFace[]) {
  const entries = faces.filter(face => Math.abs(face.normal[1]) < .001).map(face => {
    const points = face.vertices.map(v => v.position), [nx, , nz] = face.normal
    return { face, nx, nz, d: nx * points[0][0] + nz * points[0][2],
      minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
      minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])),
      minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])),
      x: points.reduce((sum, p) => sum + p[0], 0) / 4, z: points.reduce((sum, p) => sum + p[2], 0) / 4 }
  })
  const bins = new Map<string, typeof entries>()
  for (const entry of entries) {
    for (let x = Math.floor(entry.minX - .001); x <= Math.floor(entry.maxX + .001); x++) {
      for (let z = Math.floor(entry.minZ - .001); z <= Math.floor(entry.maxZ + .001); z++) {
        const key = `${x}:${z}`, bin = bins.get(key) ?? []
        bin.push(entry); bins.set(key, bin)
      }
    }
  }
  const result = new Map<WallMeshFace, [number, number, number][]>()
  const indices = new Map(entries.map((entry, index) => [entry, index])), seen = new Set<string>()
  for (const bin of bins.values()) for (const a of bin) for (const b of bin) {
    const ai = indices.get(a)!, bi = indices.get(b)!, key = `${ai}:${bi}`
    if (ai >= bi || seen.has(key)) continue
    seen.add(key)
    if (Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) < .001) continue
    const determinant = a.nx * b.nz - a.nz * b.nx
    if (Math.abs(determinant) < .01) continue
    const x = (a.d * b.nz - a.nz * b.d) / determinant, z = (a.nx * b.d - a.d * b.nx) / determinant
    if ([a, b].some(e => x < e.minX - .001 || x > e.maxX + .001 || z < e.minZ - .001 || z > e.maxZ + .001)) continue
    // Both faces must extend into the other's lit half-space. A convex outside
    // corner has the opposite sign and must retain its ordinary receiver.
    if (a.x * b.nx + a.z * b.nz - b.d < .001 || b.x * a.nx + b.z * a.nz - a.d < .001) continue
    for (const [owner, other] of [[a, b], [b, a]]) {
      const plane: [number, number, number] = [other.nx, other.nz, other.d]
      const planes = result.get(owner.face) ?? []
      if (!planes.some(p => p.every((value, i) => Math.abs(value - plane[i]) < .0001))) planes.push(plane)
      result.set(owner.face, planes)
    }
  }
  return result
}
