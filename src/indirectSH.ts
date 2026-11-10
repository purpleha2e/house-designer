import { Vector3, type SphericalHarmonics3 } from 'three'

export type IndirectSHOrder = 1 | 2
export const indirectSHCoefficientCount = (order: IndirectSHOrder = 1) => order === 2 ? 9 : 4

/** Experimental opt-in. Workers receive the order in their field/request data. */
export function requestedIndirectSHOrder(): IndirectSHOrder {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('giSH') === '2' ? 2 : 1
}

/** Keep the existing representation when the full, unresized experimental
 * volume (including diagnostic sky slabs) does not fit the device. */
export function supportedIndirectSHOrder(requested: IndirectSHOrder, floors: number, max3DSize: number, diagnostics = false): IndirectSHOrder {
  return requested === 2 && Math.max(1, floors) * 14 * 9 * (diagnostics ? 2 : 1) <= max3DSize ? 2 : 1
}

/** Real SH convention used by Three: Y00, Y1y, Y1z, Y1x, Y2xy, Y2yz,
 * Y2(3z²-1), Y2xz, Y2(x²-y²). Coefficients represent incoming radiance. */
export function indirectSHRadianceBasis(normal: Vector3, order: IndirectSHOrder = 1) {
  const { x, y, z } = normal
  const basis = [.2820947918, .4886025119 * y, .4886025119 * z, .4886025119 * x]
  if (order === 2) basis.push(1.0925484305920792 * x * y, 1.0925484305920792 * y * z,
    .31539156525252005 * (3 * z * z - 1), 1.0925484305920792 * x * z,
    .5462742152960396 * (x * x - y * y))
  return basis
}

/** Cosine convolution by band: π, 2π/3, π/4. Preserve the existing L1 rounded
 * constants exactly so an L1 model does not change when the experiment is off. */
export function indirectSHIrradianceBasis(normal: Vector3, order: IndirectSHOrder = 1) {
  const { x, y, z } = normal
  const basis = [.886227, 1.023328 * y, 1.023328 * z, 1.023328 * x]
  if (order === 2) basis.push(.8580855308097834 * x * y, .8580855308097834 * y * z,
    .24770795610037571 * (3 * z * z - 1), .8580855308097834 * x * z,
    .4290427654048917 * (x * x - y * y))
  return basis
}

export function evaluateIndirectSHOrder(sh: SphericalHarmonics3, normal: Vector3, order: IndirectSHOrder = 1) {
  const result = new Vector3(), basis = indirectSHIrradianceBasis(normal, order)
  for (let i = 0; i < basis.length; i++) result.addScaledVector(sh.coefficients[i], basis[i])
  return result.max(new Vector3())
}

/** Shared integration equations; every GPU capture/replay reduction uses these
 * radiance functions, then applies the cosine convolution only at receivers. */
export function indirectSHIntegrationGLSL(order: IndirectSHOrder = 1) {
  return `float hdSHRadianceBasis(int coefficient,vec3 direction) {
    if(coefficient==0)return .2820947918;
    if(coefficient==1)return .4886025119*direction.y;
    if(coefficient==2)return .4886025119*direction.z;
    if(coefficient==3)return .4886025119*direction.x;
    ${order === 2 ? `if(coefficient==4)return 1.0925484305920792*direction.x*direction.y;
    if(coefficient==5)return 1.0925484305920792*direction.y*direction.z;
    if(coefficient==6)return .31539156525252005*(3.0*direction.z*direction.z-1.0);
    if(coefficient==7)return 1.0925484305920792*direction.x*direction.z;
    return .5462742152960396*(direction.x*direction.x-direction.y*direction.y);` : 'return 0.0;'}
  }`
}

export const indirectL2IrradianceGLSL = `
  + .8580855308097834*(c4*n.x*n.y+c5*n.y*n.z+c7*n.x*n.z)
  + c6*(.24770795610037571*(3.0*n.z*n.z-1.0))
  + c8*(.4290427654048917*(n.x*n.x-n.y*n.y))`
