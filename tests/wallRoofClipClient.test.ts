import assert from 'node:assert/strict'
import test from 'node:test'
import { clipWallFacesInWorker } from '../src/wallEngine/wallRoofClipClient.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

const faces = [{ wallId: 'wall' }] as WallMeshFace[]
const options = { floorElevation: 0, volumes: [{ planes: roofFacePlanes([[0, 1, 0], [1, 1, 0], [1, 1, 1]]),
  protectedFootprints: [], excludedWallIds: new Set<string>(), clipSides: true }] }

test('clipping jobs terminate on cancellation, ignore late replies, and report failures without blocking fallback', async () => {
  const original = globalThis.Worker
  const workers: FakeWorker[] = []
  class FakeWorker {
    terminated = false
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    onmessageerror?: () => void
    constructor() { workers.push(this) }
    postMessage(job: unknown) { structuredClone(job) }
    terminate() { this.terminated = true }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const cancelled = new AbortController()
    const old = clipWallFacesInWorker(faces, options, cancelled.signal)
    const rejected = assert.rejects(old, { name: 'AbortError' })
    cancelled.abort()
    workers[0].onmessage?.({ data: { ok: true, faces: ['obsolete'] } })
    await rejected
    assert.ok(workers[0].terminated)

    const current = clipWallFacesInWorker(faces, options, new AbortController().signal)
    workers[1].onmessage?.({ data: { ok: true, faces } })
    assert.deepEqual(await current, faces)
    assert.ok(workers[1].terminated)

    const failed = clipWallFacesInWorker(faces, options, new AbortController().signal)
    workers[2].onerror?.({ message: 'worker failed' })
    await assert.rejects(failed, /worker failed/)
    assert.ok(workers[2].terminated)

    await assert.rejects(clipWallFacesInWorker(faces, options, cancelled.signal), { name: 'AbortError' })
    assert.equal(workers.length, 3)
  } finally { globalThis.Worker = original }
})
