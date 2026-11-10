import assert from 'node:assert/strict'
import test from 'node:test'
import { disposeIdleBuildingPreparationWorkers, requestBuildingPreparation } from '../src/buildingPreparationClient.ts'
import type { BuildingPreparationRequest } from '../src/buildingPreparation.ts'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminated = false
  messages: unknown[] = []
  constructor() { FakeWorker.instances.push(this) }
  postMessage(data: unknown) { this.messages.push(data) }
  terminate() { this.terminated = true }
  reply(result: unknown) { this.onmessage?.({ data: { ok: true, result } }) }
}
const request = { kind: 'rooms', roofFloors: [], roomFloors: [] } as BuildingPreparationRequest

test('successive door preparation jobs reuse warm workers and bound the idle pool', async t => {
  const previousWorker = globalThis.Worker
  globalThis.Worker = FakeWorker as never
  t.after(() => { globalThis.Worker = previousWorker })
  FakeWorker.instances = []
  try {
    const first = requestBuildingPreparation(request, new AbortController().signal)
    const worker = FakeWorker.instances[0]
    worker.reply('first'); assert.equal(await first, 'first')
    const next = requestBuildingPreparation(request, new AbortController().signal)
    assert.equal(FakeWorker.instances.length, 1)
    assert.equal(worker.messages.length, 2)
    worker.reply('next'); assert.equal(await next, 'next')
    const concurrent = Array.from({ length: 3 }, () => requestBuildingPreparation(request, new AbortController().signal))
    FakeWorker.instances.forEach((w, i) => w.reply(i))
    await Promise.all(concurrent)
    assert.equal(FakeWorker.instances.filter(w => !w.terminated).length, 2)
  } finally { disposeIdleBuildingPreparationWorkers() }
})

test('aborted and failed building workers are terminated instead of being returned to the pool', async t => {
  const previousWorker = globalThis.Worker
  globalThis.Worker = FakeWorker as never
  t.after(() => { globalThis.Worker = previousWorker })
  FakeWorker.instances = []
  try {
    const controller = new AbortController()
    const cancelled = requestBuildingPreparation(request, controller.signal)
    const oldReply = FakeWorker.instances[0].onmessage!
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(FakeWorker.instances[0].terminated, true)
    oldReply({ data: { ok: true, result: 'obsolete' } })
    const failed = requestBuildingPreparation(request, new AbortController().signal)
    FakeWorker.instances[1].onerror!({ message: 'failed' })
    await assert.rejects(failed, /failed/)
    assert.equal(FakeWorker.instances[1].terminated, true)
    await assert.rejects(requestBuildingPreparation(request, controller.signal), { name: 'AbortError' })
    assert.equal(FakeWorker.instances.length, 2, 'an already-aborted job never starts a worker')
  } finally { disposeIdleBuildingPreparationWorkers() }
})
