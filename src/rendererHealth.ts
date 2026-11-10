import type { Camera, Object3D, WebGLRenderer } from 'three'
type TrackedTarget = NonNullable<Parameters<WebGLRenderer['setRenderTarget']>[0]>

type HealthEvent = { type: string; at: number; detail?: string }
type TargetInfo = { width: number; height: number; samples: number; textures: number; depth: boolean }
const installed = new WeakMap<WebGLRenderer, ReturnType<typeof createHealth>>()
export const rendererHealthHistory: { id: number; events: HealthEvent[]; renders: number; frames: number }[] = []
let nextId = 0

function createHealth(renderer: WebGLRenderer, scene: Object3D, restored?: () => void) {
  const id = ++nextId, canvas = renderer.domElement, events: HealthEvent[] = []
  const targets = new Map<number, TargetInfo>(), seen = new WeakMap<TrackedTarget, number>()
  let nextTargetId = 0
  let renders = 0, frames = 0, lastFrameAt = 0, lastRenderAt = 0, disposed = false, contextGeneration = 0
  let lastCamera: Camera | undefined
  const record = (type: string, detail?: string) => {
    events.push({ type, at: performance.now(), ...(detail ? { detail } : {}) })
    if (events.length > 100) events.shift()
  }
  const track = (target: TrackedTarget | null) => {
    if (!target) return
    let targetId = seen.get(target)
    if (targetId !== undefined && targets.has(targetId)) return
    if (targetId === undefined) {
      targetId = ++nextTargetId; seen.set(target, targetId)
      const id = targetId
      target.addEventListener('dispose', () => { targets.delete(id) })
    }
    targets.set(targetId, { width: target.width, height: target.height, samples: target.samples,
      textures: target.textures.length, depth: target.depthBuffer })
  }
  const snapshot = (checkGL = false) => {
    const context = renderer.getContext(), target = renderer.getRenderTarget(), errors: number[] = []
    const lost = context.isContextLost()
    if (checkGL && !lost) for (let i = 0; i < 8; i++) { const code = context.getError(); if (!code) break; errors.push(code) }
    const framebuffer = checkGL && !lost ? context.checkFramebufferStatus(context.FRAMEBUFFER) : undefined
    if (errors.length) record('webgl-error', errors.join(','))
    if (framebuffer !== undefined && framebuffer !== context.FRAMEBUFFER_COMPLETE) record('invalid-framebuffer', String(framebuffer))
    return { id, disposed, contextGeneration, lost, frames, renders, lastFrameAt, lastRenderAt,
      canvas: { width: canvas.width, height: canvas.height, connected: canvas.isConnected },
      viewport: checkGL && !lost ? Array.from(context.getParameter(context.VIEWPORT) as Int32Array) : undefined,
      scissor: checkGL && !lost ? Array.from(context.getParameter(context.SCISSOR_BOX) as Int32Array) : undefined,
      scissorTest: checkGL && !lost ? context.isEnabled(context.SCISSOR_TEST) : undefined,
      target: target ? { width: target.width, height: target.height, samples: target.samples } : null,
      framebuffer, errors, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0, targets: [...targets.values()], events: [...events],
      camera: lastCamera ? { finite: [...lastCamera.matrixWorld.elements, ...lastCamera.projectionMatrix.elements].every(Number.isFinite),
        position: lastCamera.position.toArray() } : null,
      shaderFailure: scene.userData.shaderWarmupFailure, preparation: scene.userData.viewportPreparation,
    }
  }
  const lost = (event: Event) => { record('context-lost', (event as WebGLContextEvent).statusMessage); contextGeneration++; targets.clear() }
  const restore = () => {
    record('context-restored'); contextGeneration++
    scene.traverse(object => {
      const shadow = Reflect.get(object, 'shadow') as { needsUpdate: boolean } | undefined
      if (shadow) shadow.needsUpdate = true
    })
    renderer.shadowMap.needsUpdate = true
    restored?.()
  }
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', restore)
  const render = renderer.render.bind(renderer), compile = renderer.compileAsync.bind(renderer)
  const setTarget = renderer.setRenderTarget.bind(renderer), initTarget = renderer.initRenderTarget.bind(renderer)
  const dispose = renderer.dispose.bind(renderer)
  renderer.render = (...args) => {
    renders++; lastRenderAt = performance.now(); lastCamera = args[1]
    try { return render(...args) } catch (error) { record('render-exception', String(error)); throw error }
  }
  renderer.compileAsync = (...args) => {
    try { return compile(...args).catch(error => { record('shader-failure', String(error)); throw error }) }
    catch (error) { record('shader-failure', String(error)); throw error }
  }
  renderer.setRenderTarget = (target, ...args) => { track(target); return setTarget(target, ...args) }
  renderer.initRenderTarget = target => { track(target); return initTarget(target) }
  renderer.dispose = () => {
    if (disposed) return
    disposed = true; record('disposed')
    canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restore)
    rendererHealthHistory.push({ id, events: [...events], renders, frames })
    if (rendererHealthHistory.length > 16) rendererHealthHistory.shift()
    delete scene.userData.getRendererHealth
    return dispose()
  }
  record('created')
  scene.userData.getRendererHealth = snapshot
  return { snapshot, frame(camera: Camera) { frames++; lastFrameAt = performance.now(); lastCamera = camera } }
}

/** Normal frames only update counters. GL queries require explicit inspection. */
export function installRendererHealth(renderer: WebGLRenderer, scene: Object3D, restored?: () => void) {
  let health = installed.get(renderer)
  if (!health) { health = createHealth(renderer, scene, restored); installed.set(renderer, health) }
  return health
}

export function recordRendererFrame(renderer: WebGLRenderer, camera: Camera) {
  installed.get(renderer)?.frame(camera)
}
