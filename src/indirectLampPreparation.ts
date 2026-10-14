import { Vector3 } from 'three'
import { indirectOctDirection, type IndirectVisibilitySnapshot, type IndirectVisibility } from './indirectVisibility.ts'

export type IndirectLampQuery = { visibility: IndirectVisibilitySnapshot; lights: [number, number, number][]; size: number }
export type IndirectLampTask = IndirectLampQuery & { firstRow: number; rowCount: number }

/** Rows are packed consecutively by lamp, independent of the display atlas. */
export function traceIndirectLampRows(task: Omit<IndirectLampTask, 'visibility'>, visibility: IndirectVisibility) {
  const data = new Float32Array(task.rowCount * task.size), position = new Vector3()
  for (let row = 0; row < task.rowCount; row++) {
    const source = task.firstRow + row, lamp = Math.floor(source / task.size), y = source % task.size
    position.fromArray(task.lights[lamp])
    for (let x = 0; x < task.size; x++) {
      const hit = visibility.hit(position, indirectOctDirection((x + .5) / task.size, (y + .5) / task.size))
      data[row * task.size + x] = typeof hit?.faceIndex === 'number' ? visibility.primitiveId(hit.faceIndex) : 0
    }
  }
  return data
}

export function applyIndirectLampRows(field: { distanceData: Float32Array; distanceWidth: number; distanceSize: number; distanceColumns: number },
  firstRow: number, data: Float32Array) {
  const size = field.distanceSize
  for (let row = 0; row < data.length / size; row++) {
    const source = firstRow + row, lamp = Math.floor(source / size), y = source % size
    const tileX = lamp % field.distanceColumns * size, tileY = Math.floor(lamp / field.distanceColumns) * size
    field.distanceData.set(data.subarray(row * size, (row + 1) * size), (tileY + y) * field.distanceWidth + tileX)
  }
}
