import { Color, HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { RoomExposureEffect } from '../../src/roomExposure'

const renderer = new WebGLRenderer({ preserveDrawingBuffer: true })
renderer.setSize(96, 96); document.body.append(renderer.domElement)
const scene = new Scene(), camera = new PerspectiveCamera(), exposure = new RoomExposureEffect()
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
const pass = new EffectPass(camera, exposure, tone); composer.addPass(pass)
const pixel = new Uint8Array(4)
const capture = () => {
  const context = renderer.getContext()
  context.readPixels(48, 48, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
  const rgb = Array.from(pixel.slice(0, 3))
  const target = exposure.history.find(target => target.texture === exposure.uniforms.get('roomExposure')!.value)!
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
  return { rgb, stops: (pixel[0] / 255 + pixel[1] / 65025) * 2 }
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function run() {
  const rows = []
  for (const luminance of [.03, .3, 0]) {
    scene.background = new Color().setRGB(luminance, luminance, luminance)
    composer.render(); const initial = capture()
    const until = performance.now() + 4200
    while (performance.now() < until) { await wait(50); composer.render() }
    rows.push({ luminance, initial, settled: capture() })
  }
  composer.removePass(pass); pass.dispose()
  composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })))
  scene.background = new Color().setRGB(.03, .03, .03); composer.render()
  const context = renderer.getContext(); context.readPixels(48, 48, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
  return { rows, manual: Array.from(pixel.slice(0, 3)) }
}
Object.assign(window, { roomExposureResult: run() })
