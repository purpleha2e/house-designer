import type { BufferGeometry } from 'three'

/** Wood textures run along U. Rotate the existing unwrap without changing scale. */
export function rotateStairUvs(geometry: BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), -uv.getX(i))
  return geometry
}

/** One UV unit per metre, including thin box ends and vertical risers. */
export function setStairWorldUvs(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uvs = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) {
    const x = Math.abs(normals.getX(i)), y = Math.abs(normals.getY(i)), z = Math.abs(normals.getZ(i))
    uvs.setXY(i, x > y && x > z ? positions.getZ(i) : positions.getX(i), y >= x && y >= z ? -positions.getZ(i) : positions.getY(i))
  }
  return geometry
}
