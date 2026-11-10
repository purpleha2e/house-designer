import type { WebGLRenderer } from 'three'
import { yieldToViewport } from './viewportScheduling.ts'
import { cacheLightingUniformArrays } from './rendererUniformArrays.ts'

const installed = new WeakSet<WebGLRenderer>()
type Program = NonNullable<WebGLRenderer['info']['programs']>[number]

/** Successful diagnostic logs can stall the driver for seconds. Check links
 * cooperatively, including programs first encountered by a capture/display draw,
 * and fetch the detailed logs only when a link actually failed. */
export function installNonBlockingShaderDiagnostics(renderer: WebGLRenderer, options: { contextSafePolling?: boolean } = {}) {
  if (installed.has(renderer)) return
  installed.add(renderer)
  const initialised = new WeakSet<object>(), verified = new WeakSet<object>()
  const pendingDrawChecks = new WeakSet<object>(), reported = new WeakSet<object>()
  let contextEpoch = 0
  const changed = () => { contextEpoch++ }
  renderer.domElement?.addEventListener('webglcontextlost', changed)
  renderer.domElement?.addEventListener('webglcontextrestored', changed)
  const initialise = async (program: Program, setup: boolean) => {
    const epoch = contextEpoch
    await yieldToViewport()
    const context = renderer.getContext()
    if (epoch !== contextEpoch || context.isContextLost?.()) return
    const parallel = renderer.extensions.get('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
    const handle = program.program as WebGLProgram | undefined
    if (!handle) return
    // A double-sided material can create more than the program compileAsync
    // polls. Check each one before querying status or uniform locations.
    while (epoch === contextEpoch && !context.isContextLost?.() && !verified.has(program) && program.program === handle && parallel && !context.getProgramParameter(handle, parallel.COMPLETION_STATUS_KHR)) await yieldToViewport()
    if (epoch !== contextEpoch || context.isContextLost?.()) return
    if (program.program !== handle || initialised.has(program)) return
    if (!verified.has(program) && context.getProgramParameter(handle, context.LINK_STATUS) === false) {
      const details = [context.getProgramInfoLog(handle), context.getShaderInfoLog(program.vertexShader),
        context.getShaderInfoLog(program.fragmentShader)].filter(Boolean).join('\n')
      const report = renderer.debug.onShaderError as unknown as ((gl: WebGLRenderingContext | WebGL2RenderingContext,
        handle: WebGLProgram, vertex: WebGLShader, fragment: WebGLShader) => void) | null
      report?.(context, handle, program.vertexShader, program.fragmentShader)
      throw new Error(`Shader preparation failed (${program.name || program.id}): ${details}`)
    }
    verified.add(program)
    // A retained display can run while compileAsync is preparing another
    // program in the same cache. Checking it must not skip its warmup setup.
    if (!setup) return
    const diagnostics = renderer.debug.checkShaderErrors
    try {
      renderer.debug.checkShaderErrors = false
      cacheLightingUniformArrays(program.getUniforms()); program.getAttributes()
      initialised.add(program)
    } finally { renderer.debug.checkShaderErrors = diagnostics }
  }
  const compile = renderer.compileAsync.bind(renderer)
  const submit = options.contextSafePolling ? renderer.compile?.bind(renderer) : undefined
  renderer.compileAsync = (...args) => {
    const epoch = contextEpoch
    // Native compileAsync polls material properties even after context restore
    // replaces them. Submit with the same native compile(), then use the existing
    // cancellable program checks instead of stacking two independent pollers.
    const pending = submit ? Promise.resolve(submit(...args)).then(() => args[0]) : compile(...args)
    const programs = renderer.info.programs?.filter(program => !initialised.has(program)) ?? []
    return pending.then(async result => {
      for (const program of programs) await initialise(program, true)
      if (epoch !== contextEpoch || renderer.getContext().isContextLost?.()) throw new Error('Shader preparation interrupted by WebGL context change')
      return result
    })
  }
  const dispose = renderer.dispose?.bind(renderer)
  if (dispose) renderer.dispose = () => {
    changed()
    renderer.domElement?.removeEventListener('webglcontextlost', changed)
    renderer.domElement?.removeEventListener('webglcontextrestored', changed)
    dispose()
  }
  const render = renderer.render?.bind(renderer)
  if (render) renderer.render = (...args) => {
    const diagnostics = renderer.debug.checkShaderErrors
    try {
      renderer.debug.checkShaderErrors = false
      return render(...args)
    } finally {
      renderer.debug.checkShaderErrors = diagnostics
      if (diagnostics) for (const program of renderer.info.programs ?? []) {
        if (verified.has(program) || pendingDrawChecks.has(program) || reported.has(program)) continue
        pendingDrawChecks.add(program)
        // First draw already initialised uniforms. Preserve failure reporting
        // outside the input/display task without repeating successful setup.
        void initialise(program, false).catch(error => { reported.add(program); console.error(error) })
          .finally(() => pendingDrawChecks.delete(program))
      }
    }
  }
}
