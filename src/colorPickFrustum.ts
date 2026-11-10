import { Frustum, Matrix4, type Camera } from 'three'

/** Conservative bounds for the pixels the existing colour picker will read.
 * Scissoring alone still uploads every mesh in the full camera frustum. This
 * changes candidate bounds only; raster projection, depth and readback stay exact. */
export function colorPickSampleFrustum(camera: Camera, width: number, height: number,
  sample: { x: number; y: number; radiusX: number; radiusY: number }) {
  const left = Math.max(0, sample.x - sample.radiusX - 1)
  const bottom = Math.max(0, sample.y - sample.radiusY - 1)
  const right = Math.min(width, sample.x + sample.radiusX + 2)
  const top = Math.min(height, sample.y + sample.radiusY + 2)
  const w = right - left, h = top - bottom
  const crop = new Matrix4().set(
    width / w, 0, 0, (width - 2 * left - w) / w,
    0, height / h, 0, (height - 2 * bottom - h) / h,
    0, 0, 1, 0,
    0, 0, 0, 1,
  )
  return new Frustum().setFromProjectionMatrix(
    crop.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse),
    camera.coordinateSystem, camera.reversedDepth,
  )
}
