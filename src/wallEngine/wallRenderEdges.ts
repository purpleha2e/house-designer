import type { WallMeshFace, WallMeshVertex } from './wallMesh.ts'

const EPS = 1e-7

/** Roof material regions meet in T junctions. Split both sides of those edges
 * before uploading Float32 triangles, which otherwise rasterize a hairline
 * crack between the long edge and its independently rounded short segments.
 * Keep face identity, paint, picking and the original per-face UV frame. */
export function conformWallRenderEdges(faces: WallMeshFace[]) {
  const groups = new Map<string, WallMeshFace[]>()
  for (const face of faces) {
    if (face.kind !== 'side') continue
    const key = `${face.wallId}:${face.normal.map(n => n.toFixed(6)).join(':')}`
    const group = groups.get(key)
    if (group) group.push(face)
    else groups.set(key, [face])
  }
  const result = new Map<WallMeshFace, WallMeshVertex[]>()
  for (const group of groups.values()) {
    if (!group.some(face => face.roofSurfaceRegion)) continue
    const points = [...new Map(group.flatMap(face => face.vertices.map(({ position }) =>
      [position.map(v => Math.round(v / EPS)).join(':'), position] as const))).values()]
    for (const face of group) {
      let changed = false
      const ring = face.vertices.filter((v, i) => Math.hypot(...v.position.map((n, axis) =>
        n - face.vertices[(i + face.vertices.length - 1) % face.vertices.length].position[axis])) > EPS)
      const vertices = ring.flatMap((a, i) => {
        const b = ring[(i + 1) % ring.length]
        const d = b.position.map((v, axis) => v - a.position[axis])
        const lengthSquared = d.reduce((sum, v) => sum + v * v, 0)
        const tolerance = EPS / Math.sqrt(lengthSquared)
        const splits = points.flatMap(position => {
          const t = position.reduce((sum, v, axis) => sum + (v - a.position[axis]) * d[axis], 0) / lengthSquared
          if (t <= tolerance || t >= 1 - tolerance ||
            Math.hypot(...position.map((v, axis) => v - a.position[axis] - t * d[axis])) > EPS) return []
          return [{ t, position }]
        }).sort((a, b) => a.t - b.t)
        if (splits.length) changed = true
        return [a, ...splits.map(({ t, position }): WallMeshVertex => ({
          position, uv: [a.uv[0] + t * (b.uv[0] - a.uv[0]), a.uv[1] + t * (b.uv[1] - a.uv[1])],
        }))]
      })
      if (changed) result.set(face, vertices)
    }
  }
  return result
}
