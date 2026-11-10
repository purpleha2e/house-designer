// Three 0.185.1 caches scalar uniforms, but PureArrayUniform uploads are
// unconditional. Cache only the shared numeric arrays measured by the audit.
// A cache belongs to one linked program's uniform object, never to a material.
const names = new Set(['directionalShadowMatrix', 'pointShadowMatrix', 'hdGIFloorRanges', 'hdGIPointIndices',
  'hdPointLightRoomIds', 'hdPointOcclusionIds', 'hdSpotLightRoomIds', 'hdSpotOcclusionIds',
  'hdRoomLightFloorHeights', 'hdLightPortalEdgeRanges', 'hdLightPortalHeights'])
const widths = new Map([[0x1406, 1], [0x8b50, 2], [0x8b51, 3], [0x8b52, 4], [0x8b5a, 4], [0x8b5b, 9], [0x8b5c, 16]])
const vectorKeys = ['x', 'y', 'z', 'w'] as const, colourKeys = ['r', 'g', 'b'] as const
const installed = new WeakSet<object>()
type Component = { elements?: ArrayLike<number>; isColor?: boolean; x?: number; y?: number; z?: number;
  w?: number; r?: number; g?: number; b?: number }
type NumericArray = ArrayLike<number> | ArrayLike<Component>
type Uniform = { id: string; type: number; size?: number;
  setValue: (this: Uniform, gl: unknown, value: NumericArray, textures?: unknown) => unknown }

function matches(last: number[], value: NumericArray, width: number, flat: boolean) {
  if (flat) {
    const numbers = value as ArrayLike<number>
    for (let i = 0; i < numbers.length; i++) if (!Object.is(last[i], numbers[i])) return false
  } else {
    const members = value as ArrayLike<Component>
    let index = 0
    for (let i = 0; i < members.length; i++) {
      const member = members[i], elements = member?.elements
      if (elements) {
        for (let c = 0; c < width; c++) if (!Object.is(last[index++], elements[c])) return false
      } else {
        const keys = member?.isColor ? colourKeys : vectorKeys
        for (let c = 0; c < width; c++) if (!Object.is(last[index++], member?.[keys[c]])) return false
      }
    }
  }
  return true
}

function remember(last: number[], value: NumericArray, width: number, flat: boolean) {
  let valid = true, index = 0
  const append = (n: number | undefined) => {
    last[index++] = n as number
    valid &&= typeof n === 'number' && n === n
  }
  if (flat) {
    const numbers = value as ArrayLike<number>
    for (let i = 0; i < numbers.length; i++) append(numbers[i])
  } else {
    const members = value as ArrayLike<Component>
    for (let i = 0; i < members.length; i++) {
      const member = members[i], elements = member?.elements
      if (elements) {
        for (let c = 0; c < width; c++) append(elements[c])
      } else {
        const keys = member?.isColor ? colourKeys : vectorKeys
        for (let c = 0; c < width; c++) append(member?.[keys[c]])
      }
    }
  }
  return valid
}

/** Existing first-use shader setup supplies the linked program's uniform table.
 * No per-frame program scan, GL interception, sampler cache or global strong
 * program references. New/relinked context programs receive fresh caches. */
export function cacheLightingUniformArrays(uniforms: unknown) {
  const seq = (uniforms as { seq?: unknown } | undefined)?.seq
  if (!Array.isArray(seq)) return 0
  let count = 0
  for (const entry of seq) {
    if (!entry || typeof entry !== 'object') continue
    const u = entry as Uniform, width = widths.get(u.type)
    if (installed.has(u) || !names.has(u.id) || typeof u.size !== 'number' || !width || typeof u.setValue !== 'function') continue
    installed.add(u); count++
    const original = u.setValue, last: number[] = []
    let valid = false
    u.setValue = function (gl, value, textures) {
      const flat = value && typeof value[0] === 'number', length = value?.length * (flat ? 1 : width)
      // The prior snapshot is already known numeric and non-NaN. Exact equality
      // against it validates new values too, including signed zero. Walk each
      // vector/matrix once instead of decoding its member for every component.
      if (valid && last.length === length && length > 0 && matches(last, value, width, flat)) return
      valid = false
      const result = original.call(this, gl, value, textures)
      if (!(length > 0)) return result
      last.length = length
      valid = remember(last, value, width, flat)
      return result
    }
  }
  return count
}
