import type { BufferGeometry, Material, WebGLRenderer } from 'three'

// Native GL methods have heterogeneous signatures at this reflective boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativeMethod = (...args: any[]) => any

/** Generic vertex attribute values belong to the GL context, not a VAO.
 * Three installs material defaults while creating a VAO, but later reuses it
 * after other programs have written different values to those same locations.
 * Reassert missing attributes at the draw, without rebuilding/uploading meshes.
 */
export function installRendererAttributeDefaults(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const count = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number
  const known = new Uint8Array(count), values = new Float32Array(count * 4)
  const restorers: (() => void)[] = []
  let active: { geometry: BufferGeometry; material: Material } | undefined
  const wrap = (owner: object, name: string, make: (original: NativeMethod) => NativeMethod) => {
    const original = Reflect.get(owner, name)
    if (typeof original !== 'function') return
    const replacement = make(original)
    Reflect.set(owner, name, replacement)
    restorers.push(() => { if (Reflect.get(owner, name) === replacement) Reflect.set(owner, name, original) })
  }
  const record = (index: number, data: ArrayLike<number>, size: number) => {
    known[index] = 1
    for (let c = 0; c < 4; c++) values[index * 4 + c] = c < size ? data[c] : c === 3 ? 1 : 0
  }
  // Track Three's own writes as well as ours; a cache which only observes our
  // writes would itself go stale after a warmup, depth or postprocessing draw.
  for (let size = 1; size <= 4; size++) {
    wrap(gl, `vertexAttrib${size}fv`, original => function(index, data) {
      const result = original.call(gl, index, data); record(index, data, size); return result
    })
    wrap(gl, `vertexAttrib${size}f`, original => function(index, ...data) {
      const result = original.call(gl, index, ...data); record(index, data, size); return result
    })
  }
  for (const name of ['vertexAttribI4i', 'vertexAttribI4ui', 'vertexAttribI4iv', 'vertexAttribI4uiv']) {
    wrap(gl, name, original => function(index, ...args) {
      known[index] = 0; return original.call(gl, index, ...args)
    })
  }
  const apply = () => {
    if (!active) return
    const { geometry, material } = active
    const defaults = Reflect.get(material, 'defaultAttributeValues') as Record<string, number[]> | undefined
    if (!defaults) return
    const { currentProgram: program } = renderer.properties.get(material) as {
      currentProgram?: { getAttributes(): Record<string, { location: number }> }
    }
    const attributes = program?.getAttributes()
    if (!attributes) return
    for (const name in defaults) {
      if (geometry.attributes[name]) continue
      const location = attributes[name]?.location, value = defaults[name]
      if (location === undefined || location < 0 || value.length < 1 || value.length > 4) continue
      let same = known[location] === 1
      for (let c = 0; same && c < 4; c++) same = values[location * 4 + c] === Math.fround(c < value.length ? value[c] : c === 3 ? 1 : 0)
      if (!same) Reflect.get(gl, `vertexAttrib${value.length}fv`).call(gl, location, value)
    }
  }
  wrap(renderer, 'renderBufferDirect', original => function(camera, scene, geometry, material, object, group) {
    const previous = active
    active = { geometry, material }
    try { return original.call(renderer, camera, scene, geometry, material, object, group) }
    finally { active = previous }
  })
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    wrap(gl, name, original => function(...args) { apply(); return original.apply(gl, args) })
  }
  const extensions = new WeakSet<object>()
  const multiDraw = () => {
    const extension = gl.getExtension('WEBGL_multi_draw')
    if (!extension || extensions.has(extension)) return
    extensions.add(extension)
    for (const name of ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'multiDrawElementsInstancedWEBGL']) {
      wrap(extension, name, original => function(...args) { apply(); return original.apply(extension, args) })
    }
  }
  const restored = () => { known.fill(0); multiDraw() }
  multiDraw()
  renderer.domElement.addEventListener('webglcontextrestored', restored)
  return () => {
    renderer.domElement.removeEventListener('webglcontextrestored', restored)
    restorers.reverse().forEach(restore => restore())
  }
}
