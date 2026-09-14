import type { Point } from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'

type Span = { start: number; end: number; face: WallMeshFace }
const EPS = 1e-6

/** Intersect the actual wall faces at the slab junction instead of guessing
 * a finish from the last assignment anywhere on a supporting wall. */
function wallSpans(point: Point, next: Point, faces: WallMeshFace[], height: number) {
  const dx = next.x-point.x, dz = next.y-point.y, length = Math.hypot(dx,dz)
  if (length < EPS) return []
  const spans: Span[] = []
  for (const face of faces) {
    if (face.kind !== 'side') continue
    if (Math.abs(face.normal[0]*dx + face.normal[2]*dz) / length > 0.001) continue
    if (face.vertices.some(v => Math.abs((v.position[0]-point.x)*dz-(v.position[2]-point.y)*dx)/length > 0.005)) continue
    const points: number[] = []
    const project = (x: number, z: number) => ((x-point.x)*dx+(z-point.y)*dz)/(length*length)
    face.vertices.forEach((b, i) => {
      const a = face.vertices[(i+face.vertices.length-1)%face.vertices.length]
      const da = a.position[1]-height, db = b.position[1]-height
      if (Math.abs(db) <= EPS) points.push(project(b.position[0],b.position[2]))
      if (da*db < -EPS*EPS) {
        const t = da/(da-db)
        points.push(project(a.position[0]+(b.position[0]-a.position[0])*t,a.position[2]+(b.position[2]-a.position[2])*t))
      }
    })
    if (points.length < 2) continue
    const start = Math.max(0,Math.min(...points)), end = Math.min(1,Math.max(...points))
    if ((end-start)*length > EPS) spans.push({ start, end, face })
  }
  return spans
}

export function splitSlabFacadeEdge({ point, nextPoint, lowerFaces, lowerHeight, upperFaces, upperHeight }: {
  point: Point; nextPoint: Point; lowerFaces: WallMeshFace[]; lowerHeight: number
  upperFaces: WallMeshFace[]; upperHeight: number
}) {
  const lower = wallSpans(point,nextPoint,lowerFaces,lowerHeight)
  const upper = wallSpans(point,nextPoint,upperFaces,upperHeight)
  const breaks = [0,1,...[...lower,...upper].flatMap(s => [s.start,s.end])].sort((a,b)=>a-b)
    .filter((v,i,all)=>i===0 || v-all[i-1]>EPS)
  const at = (t: number) => ({ x: point.x+(nextPoint.x-point.x)*t, y: point.y+(nextPoint.y-point.y)*t })
  const pieces = breaks.slice(0,-1).map((start,i) => {
    const end=breaks[i+1], middle=(start+end)/2
    return { point: at(start), nextPoint: at(end),
      lowerFace: lower.find(s => middle >= s.start-EPS && middle <= s.end+EPS)?.face,
      upperFace: upper.find(s => middle >= s.start-EPS && middle <= s.end+EPS)?.face }
  })
  return pieces.reduce<typeof pieces>((result, piece) => {
    const previous = result.at(-1)
    if (previous && previous.lowerFace?.faceId === piece.lowerFace?.faceId &&
      previous.upperFace?.faceId === piece.upperFace?.faceId) {
      previous.nextPoint = piece.nextPoint
    } else result.push(piece)
    return result
  }, [])
}
