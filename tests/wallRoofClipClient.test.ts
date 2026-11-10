import assert from 'node:assert/strict'
import test from 'node:test'
import { clipWallFacesInWorker, disposeIdleWallClippingWorkers, isWallClippingPending, subscribeWallClipping, prepareWallFacesForRoofsInWorker } from '../src/wallEngine/wallRoofClipClient.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

const faces = [{ wallId: 'wall' }] as WallMeshFace[]
const options = { floorElevation: 0, volumes: [{ planes: roofFacePlanes([[0, 1, 0], [1, 1, 0], [1, 1, 1]]),
  protectedFootprints: [], excludedWallIds: new Set<string>(), clipSides: true }] }

test('clipping and finish preparation deliver both streamed results in one worker job', async () => {
  const original = globalThis.Worker
  let worker: { onmessage?: ((event: { data: unknown }) => void) | null; job?: unknown } | undefined
  globalThis.Worker = class {
    onmessage?: ((event: { data: unknown }) => void) | null
    job?: unknown
    constructor() { worker = this }
    postMessage(job: unknown) { this.job = structuredClone(job) }
    terminate() {}
  } as unknown as typeof Worker
  try {
    const pending = prepareWallFacesForRoofsInWorker(faces, { floorId: 'floor', floorElevation: 0, roofs: [], walls: [], roomPolygons: [] },
      { floorId: 'floor', walls: [], rooms: [], exteriorWallSidesByWallId: new Map(), roofSupports: [] }, new AbortController().signal,
      { floorId: 'floor', elevation: 0, walls: [], surfaceAssignments: [] })
    const renderFaces = [{ wallId: 'finished-wall' }], pickPayload = { picked: true }, renderPayload = { rendered: true }
    worker!.onmessage!({ data: { stream: 'faces', faces } })
    worker!.onmessage!({ data: { stream: 'renderFaces', faces: renderFaces } })
    worker!.onmessage!({ data: { ok: true, streamedFaces: true, pickPayload, renderPayload } })
    assert.deepEqual(await pending, { faces, pickPayload, rendering: { renderFaces, payload: renderPayload } })
    assert.ok('render' in (worker!.job as object))
    assert.equal(isWallClippingPending(), false)
  } finally { disposeIdleWallClippingWorkers(); globalThis.Worker = original }
})

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
    assert.equal(workers[1].terminated, false, 'successful workers stay warm for the next edit')

    const failed = clipWallFacesInWorker(faces, options, new AbortController().signal)
    assert.equal(workers.length, 2, 'the next job reuses the idle worker')
    workers[1].onerror?.({ message: 'worker failed' })
    await assert.rejects(failed, /worker failed/)
    assert.ok(workers[1].terminated)

    await assert.rejects(clipWallFacesInWorker(faces, options, cancelled.signal), { name: 'AbortError' })
    assert.equal(workers.length, 2)
  } finally { disposeIdleWallClippingWorkers(); globalThis.Worker = original }
})

test('wall preparation remains pending until all workers finish, including aborts and failures', async () => {
  const original = globalThis.Worker
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { error: Error }) => void
    constructor() { workers.push(this) }
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  const changes: boolean[] = []
  const unsubscribe = subscribeWallClipping(() => changes.push(isWallClippingPending()))
  const faces = [{}] as WallMeshFace[]
  const options = { floorElevation: 0, volumes: [{ planes: [], protectedFootprints: [], excludedWallIds: new Set<string>(), clipSides: true }] }
  try {
    const first = clipWallFacesInWorker(faces, options, new AbortController().signal)
    const abort = new AbortController()
    const second = clipWallFacesInWorker(faces, options, abort.signal)
    assert.equal(isWallClippingPending(), true)
    workers[0].onmessage!({ data: { ok: true, faces } })
    assert.equal(await first, faces)
    assert.equal(isWallClippingPending(), true)
    const rejected = assert.rejects(second, { name: 'AbortError' })
    abort.abort(); await rejected
    assert.equal(isWallClippingPending(), false)
    const third = clipWallFacesInWorker(faces, options, new AbortController().signal)
    const failed = assert.rejects(third, /worker failed/)
    workers[0].onerror!({ error: new Error('worker failed') }); await failed
    assert.deepEqual(changes, [true, false, true, false])
    assert.equal(await clipWallFacesInWorker([], options, new AbortController().signal).then(f => f.length), 0)
    assert.equal(isWallClippingPending(), false)
    globalThis.Worker = class { constructor() { throw new Error('Worker unavailable') } } as unknown as typeof Worker
    await assert.rejects(clipWallFacesInWorker(faces, options, new AbortController().signal), /Worker unavailable/)
    assert.equal(isWallClippingPending(), false, 'worker startup failures release the preparation gate')
  } finally {
    unsubscribe()
    disposeIdleWallClippingWorkers()
    globalThis.Worker = original
  }
})

test('large jobs yield between messages, assemble streamed replies, and stop sending when cancelled', async () => {
  const original = globalThis.Worker
  const workers: FakeWorker[] = []
  class FakeWorker {
    messages: unknown[] = []
    terminated = false
    onmessage?: (event: { data: unknown }) => void
    constructor() { workers.push(this) }
    postMessage(data: unknown) { this.messages.push(structuredClone(data)) }
    terminate() { this.terminated = true }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const many = Array.from({ length: 2000 }, (_, i) => ({ wallId: String(i) })) as WallMeshFace[]
    const controller = new AbortController()
    const work = clipWallFacesInWorker(many, options, controller.signal)
    assert.equal(workers[0].messages.length, 1, 'only the small header is sent synchronously')
    const rejected = assert.rejects(work, { name: 'AbortError' })
    controller.abort(); await rejected
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(workers[0].messages.length, 1)
    assert.equal(workers[0].terminated, true)
    const next = clipWallFacesInWorker(faces, options, new AbortController().signal)
    workers[1].onmessage!({ data: { stream: 'faces', faces: many.slice(0, 100) } })
    assert.equal(isWallClippingPending(), true, 'partial responses do not unlock the scene')
    workers[1].onmessage!({ data: { stream: 'faces', faces: many.slice(100) } })
    workers[1].onmessage!({ data: { ok: true, streamedFaces: true } })
    assert.deepEqual(await next, many)
    assert.equal(isWallClippingPending(), false)
  } finally { disposeIdleWallClippingWorkers(); globalThis.Worker = original }
})
