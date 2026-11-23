import type { Material, Object3D, Scene, WebGLRenderer } from 'three'

/** Install before the first scene render. Keep observing after an edit starts
 * preparation again, so late compilation cannot be reclassified as startup. */
export function installViewportShaderAudit(renderer: WebGLRenderer, scene: Scene) {
  const gl = renderer.getContext()
  const totals = { createProgram: 0, compileShader: 0, linkProgram: 0 }
  const events: { operation: keyof typeof totals; shader: string; at: number; stack?: string }[] = []
  const programOrigins: { material: string; object: string; differences: string[] }[] = []
  let startup: typeof totals | undefined
  const names = new WeakMap<WebGLShader, string>()
  const original = { createProgram: gl.createProgram, shaderSource: gl.shaderSource, compileShader: gl.compileShader, linkProgram: gl.linkProgram }
  const record = (operation: keyof typeof totals, shader = '') => {
    totals[operation]++
    if (startup) {
      if (!events.length) console.warn('Unexpected viewport shader activity after startup', operation, shader)
      if (events.length === 128) events.shift()
      events.push({ operation, shader, at: performance.now(), stack: new Error().stack })
    }
  }
  gl.createProgram = function () { record('createProgram'); return original.createProgram.call(this) }
  gl.shaderSource = function (shader, source) {
    const type = source.match(/^#define SHADER_TYPE (.+)$/m)?.[1]?.trim()
    const name = source.match(/^#define SHADER_NAME ([^\r\n]*)/m)?.[1]?.trim()
    names.set(shader, [type, name].filter(Boolean).join('/') || 'custom')
    original.shaderSource.call(this, shader, source)
  }
  gl.compileShader = function (shader) { record('compileShader', names.get(shader)); original.compileShader.call(this, shader) }
  gl.linkProgram = function (program) { record('linkProgram'); original.linkProgram.call(this, program) }
  const draw = renderer.renderBufferDirect.bind(renderer)
  const recordPrograms = (count: number, material: string, object: string, root?: Object3D) => {
    if (!startup || count === 0) return
    const programs = renderer.info.programs ?? []
    const peers = programs.slice(0, -count)
    for (const program of programs.slice(-count)) {
      const parts = program.cacheKey.split(',')
      const closest = peers.filter(p => p.name === program.name).map(p => {
        const cached = p.cacheKey.split(',')
        return parts.flatMap((item, i) => cached[i] === item ? [] : [`${i}: ${cached[i]?.slice(0, 40)} → ${item.slice(0, 40)}`])
      }).sort((a, b) => a.length - b.length)[0]
      if (programOrigins.length === 64) programOrigins.shift()
      let source = object
      root?.traverse(mesh => {
        const attached = (mesh as Object3D & { material?: Material | Material[] }).material
        const entries = Array.isArray(attached) ? attached : [attached]
        if (source === object && entries.some(entry =>
          entry && (renderer.properties.get(entry) as { currentProgram?: unknown }).currentProgram === program)) {
          source = mesh.userData.houseDesignerRole || mesh.name || mesh.type
        }
      })
      programOrigins.push({ material: material || program.name, object: source, differences: closest ?? [] })
    }
  }
  renderer.renderBufferDirect = (...args) => {
    const before = totals.linkProgram
    draw(...args)
    recordPrograms(totals.linkProgram - before, args[3].type, args[4].userData.houseDesignerRole || args[4].name)
  }
  const compile = renderer.compile.bind(renderer)
  renderer.compile = (...args) => {
    const before = totals.linkProgram
    const result = compile(...args)
    recordPrograms(totals.linkProgram - before, '', 'explicit warm-up', args[0])
    return result
  }
  scene.userData.viewportShaderAudit = { totals, events, programOrigins, markInteractive() { startup ??= { ...totals } }, get startup() { return startup } }
}
