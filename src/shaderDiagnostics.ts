import type { WebGLRenderer } from 'three'
import { yieldToViewport } from './viewportScheduling.ts'

const installed = new WeakSet<WebGLRenderer>()

/** Three fetches every program/shader info log on first draw, including successful
 * compiles. Some drivers block for seconds building those diagnostic strings.
 * Finish first-use setup cooperatively after compileAsync, and only fetch logs
 * for a failed link. Keep Three's normal diagnostics for unprepared draw paths. */
export function installNonBlockingShaderDiagnostics(renderer: WebGLRenderer) {
  if (installed.has(renderer)) return
  installed.add(renderer)
  const compile = renderer.compileAsync.bind(renderer)
  renderer.compileAsync = (...args) => {
    const previous = new Set(renderer.info.programs)
    const pending = compile(...args)
    const programs = renderer.info.programs?.filter(program => !previous.has(program)) ?? []
    return pending.then(async result => {
      const context = renderer.getContext()
      const parallel = renderer.extensions.get('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
      for (const program of programs) {
        await yieldToViewport()
        const handle = program.program as WebGLProgram | undefined
        if (!handle) continue
        // compileAsync only polls the final side of a double-sided transparent
        // material. Check every created program before asking for link status.
        while (parallel && !context.getProgramParameter(handle, parallel.COMPLETION_STATUS_KHR)) await yieldToViewport()
        if (context.getProgramParameter(handle, context.LINK_STATUS) === false) {
          const details = [context.getProgramInfoLog(handle), context.getShaderInfoLog(program.vertexShader),
            context.getShaderInfoLog(program.fragmentShader)].filter(Boolean).join('\n')
          // Three passes the native GL handle; its current typings name the
          // renderer's wrapper instead of the browser's WebGLProgram here.
          const report = renderer.debug.onShaderError as unknown as ((gl: WebGLRenderingContext | WebGL2RenderingContext,
            handle: WebGLProgram, vertex: WebGLShader, fragment: WebGLShader) => void) | null
          report?.(context, handle, program.vertexShader, program.fragmentShader)
          throw new Error(`Shader preparation failed (${program.name || program.id}): ${details}`)
        }
        const diagnostics = renderer.debug.checkShaderErrors
        try {
          renderer.debug.checkShaderErrors = false
          program.getUniforms()
          program.getAttributes()
        } finally { renderer.debug.checkShaderErrors = diagnostics }
      }
      return result
    })
  }
}
