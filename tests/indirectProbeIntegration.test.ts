import assert from 'node:assert/strict'
import test from 'node:test'
import { DataUtils, WebGLCubeRenderTarget, type WebGLRenderer } from 'three'
import { createIndirectProbeIntegrator } from '../src/indirectProbeIntegration.ts'

test('overlapping GPU integrations own their pixels even when readbacks settle out of order', async () => {
  const integrator = createIndirectProbeIntegrator(4), cube = new WebGLCubeRenderTarget(4)
  const reads: { pixels: Uint16Array; resolve: () => void }[] = []
  const renderer = {
    info: { render: { calls: 0 } }, getRenderTarget: () => null,
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget() {}, render() {},
    readRenderTargetPixelsAsync(_target: unknown, _x: number, _y: number, _width: number, _height: number, pixels: Uint16Array) {
      return new Promise<void>(resolve => reads.push({ pixels, resolve }))
    },
  } as unknown as WebGLRenderer
  try {
    const first = integrator.read(renderer, cube), second = integrator.read(renderer, cube)
    assert.equal(reads.length, 2, 'both GPU copies are submitted before either read completes')
    assert.notEqual(reads[0].pixels, reads[1].pixels)
    reads[1].pixels.fill(DataUtils.toHalfFloat(.5)); reads[1].resolve()
    assert.deepEqual((await second).coefficients[0].toArray(), [.5, .5, .5])
    reads[0].pixels.fill(DataUtils.toHalfFloat(.25)); reads[0].resolve()
    assert.deepEqual((await first).coefficients[0].toArray(), [.25, .25, .25])
    assert.deepEqual((await second).coefficients[0].toArray(), [.5, .5, .5])
  } finally { integrator.dispose(); cube.dispose() }
})
