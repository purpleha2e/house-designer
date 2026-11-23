import { Matrix4, Quaternion, Vector3 } from 'three'
import { indirectSHRadianceBasis } from './indirectSH.ts'
import type { ReferenceRGB } from './diffuseSceneMaterials.ts'

export type SixRayMode = 'six-fixed' | 'six-rotated' | 'six-adaptive'
export type SixRayTarget = {
  id: string; kind: 'opening' | 'lamp' | 'sunlit surface'; direction: Vector3; score: number; solidAngle: number
}
export type SixRaySample = { direction: Vector3; target?: SixRayTarget }

export function isSixRayMode(value: unknown): value is SixRayMode {
  return value === 'six-fixed' || value === 'six-rotated' || value === 'six-adaptive'
}

const axes = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0),
  new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
const tetrahedron = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(p => new Vector3().fromArray(p).normalize())
const turnAxis = new Vector3(1, 2, 3).normalize()
const extraTurns = [.71, 1.43, 2.37].map(angle => new Quaternion().setFromAxisAngle(turnAxis, angle))
const broadTurns = [new Quaternion(), ...extraTurns]

export function sixRayDirections(mode: SixRayMode, candidates: SixRayTarget[], count = 6): SixRaySample[] {
  const dominant = candidates[0]
  if (mode !== 'six-adaptive' || !dominant) {
    const rotate = mode !== 'six-fixed' && dominant
    const frame = rotate ? new Quaternion().setFromUnitVectors(axes[0], dominant.direction) : new Quaternion()
    return [null, ...extraTurns].slice(0, count / 6).flatMap((turn, i) =>
      axes.map((axis, j) => {
        const direction = axis.clone()
        if (turn) direction.applyQuaternion(turn)
        return { direction: direction.applyQuaternion(frame), target: !i && !j && rotate ? dominant : undefined }
      }))
  }
  const source = candidates.find(candidate => candidate.kind !== 'sunlit surface')
  const patch = candidates.find(candidate => candidate.kind === 'sunlit surface')
  const targets = source && patch && source.direction.dot(patch.direction) < .94 ? [source, patch] : [dominant]
  const broadCount = count - targets.length
  // A tetrahedron is full rank even before adding either targeted ray.
  // With one target retain an extra broad ray opposite that source.
  const broad = broadCount <= 5 ? tetrahedron : Array.from({ length: broadCount }, (_, i) => {
    const y = 1 - 2 * (i + .5) / broadCount, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5))
    return new Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle))
  })
  let best = broad, largestGap = -Infinity
  for (const turn of broadTurns) {
    const directions = broad.map(direction => direction.clone().applyQuaternion(turn))
    const gap = Math.min(...directions.flatMap(direction => targets.map(target => 1 - direction.dot(target.direction))))
    if (gap > largestGap) { largestGap = gap; best = directions }
  }
  if (broadCount === 5) best.push(targets[0].direction.clone().negate())
  return [...targets.map(target => ({ direction: target.direction, target })), ...best.map(direction => ({ direction }))]
}

/** Reconstruct an affine baseline from the full-rank broad sample set. Each
 * target contributes only its residual over a cap of estimated solid angle.
 * Integrating the cap's first moment avoids treating a narrow bright opening
 * as a hemisphere. Affine fields have zero residual and recover exactly. */
export function projectSixRayRadiance(mode: SixRayMode, samples: SixRaySample[], radiance: ReferenceRGB[]) {
  const regression = mode === 'six-adaptive' && samples.some(sample => sample.target)
  const gram = new Matrix4().multiplyScalar(0)
  const coefficients = new Float32Array(12)
  const rhs = new Float64Array(12)
  const broadWeight = 4 * Math.PI / samples.length
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i], basis = indirectSHRadianceBasis(sample.direction)
    if (regression && sample.target) continue
    for (let row = 0; row < 4; row++) {
      for (let c = 0; c < 3; c++) rhs[row * 3 + c] += broadWeight * basis[row] * radiance[i][c]
      if (regression) for (let col = 0; col < 4; col++) gram.elements[col * 4 + row] += broadWeight * basis[row] * basis[col]
    }
  }
  if (!regression) return coefficients.map((_, i) => rhs[i])
  const inverse = gram.invert().elements
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    for (let c = 0; c < 3; c++) coefficients[row * 3 + c] += inverse[col * 4 + row] * rhs[col * 3 + c]
  }
  const baseline = coefficients.slice()
  for (const [i, sample] of samples.entries()) if (sample.target) {
    const basis = indirectSHRadianceBasis(sample.direction)
    const area = Math.min(broadWeight, sample.target.solidAngle)
    for (let c = 0; c < 3; c++) {
      const residual = radiance[i][c] - basis.reduce((sum, b, k) => sum + b * baseline[k * 3 + c], 0)
      for (let k = 0; k < 4; k++)
        coefficients[k * 3 + c] += residual * basis[k] * area * (k === 0 ? 1 : 1 - area / (4 * Math.PI))
    }
  }
  return coefficients
}
