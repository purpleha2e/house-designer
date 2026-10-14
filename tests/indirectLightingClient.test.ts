import assert from 'node:assert/strict'
import test from 'node:test'
import { IndirectLightingClient } from '../src/indirectLightingClient.ts'
import { IndirectLampPool } from '../src/indirectLampPool.ts'
import type { IndirectLampQuery } from '../src/indirectLampPreparation.ts'

class FakeWorker {
  static all: FakeWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { message: string }) => void
  messages: { kind?: string; id: number; data?: Float32Array; firstRow?: number; rowCount?: number }[] = []
  terminated = false
  url: URL
  constructor(url: URL) { this.url = url; FakeWorker.all.push(this) }
  postMessage(message: typeof this.messages[number]) { this.messages.push(message) }
  terminate() { this.terminated = true }
  respond(data: unknown) { this.onmessage?.({ data }) }
}

async function withWorkers(run: () => Promise<void>) {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const oldCores = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
  Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 })
  FakeWorker.all = []
  try { await run() }
  finally {
    if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker)
    else Reflect.deleteProperty(globalThis, 'Worker')
    if (oldCores) Object.defineProperty(navigator, 'hardwareConcurrency', oldCores)
    else Reflect.deleteProperty(navigator, 'hardwareConcurrency')
  }
}

const query: IndirectLampQuery = { lights: [[0, 1, 0], [2, 1, 0]], size: 4,
  visibility: { positions: new Float32Array(), tree: null } }
const largeRequest = { floors: [], lights: query.lights, obstacles: [], geometry: [{
  position: new Float32Array(), stride: 3, offset: 0, normalized: false, index: null,
  ranges: [{ start: 0, count: 90000 }], matrices: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]], structural: false,
}] }

test('preparation progress keeps the request pending and small scenes stay serial', async () => withWorkers(async () => {
  const client = new IndirectLightingClient(), stages: string[] = []
  const pending = client.prepare({ ...largeRequest, geometry: [] }, progress => stages.push(progress.stage))
  const worker = FakeWorker.all[0], { id } = worker.messages[0]
  worker.respond({ id, progress: { stage: 'geometry', timings: { layout: 2 } } })
  assert.equal(FakeWorker.all.length, 1)
  worker.respond({ id, ok: true, value: 'prepared' })
  assert.equal(await pending, 'prepared')
  assert.deepEqual(stages, ['geometry'])
  client.dispose()
}))

test('helper rows assemble correctly when replies arrive out of order, then all helpers stop', async () => withWorkers(async () => {
  const pool = new IndirectLampPool(3), pending = pool.trace(query)
  const expected = Float32Array.from({ length: 32 }, (_, i) => i + 1)
  for (const worker of FakeWorker.all.slice().reverse()) {
    const task = worker.messages[0]
    worker.respond({ ok: true, data: expected.slice(task.firstRow! * 4, (task.firstRow! + task.rowCount!) * 4) })
  }
  assert.deepEqual(await pending, expected)
  assert.ok(FakeWorker.all.every(worker => worker.terminated))
}))

test('helper failures return the coordinator to serial work and terminate the whole pool', async () => withWorkers(async () => {
  const client = new IndirectLightingClient(), pending = client.prepare(largeRequest)
  const worker = FakeWorker.all[0], { id } = worker.messages[0]
  worker.respond({ id, progress: { stage: 'geometry', timings: {} } })
  worker.respond({ id, lampQuery: query })
  FakeWorker.all[1].onerror?.({ message: 'helper unavailable' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(worker.messages.at(-1), { id, kind: 'lampResult', data: undefined })
  assert.ok(FakeWorker.all.slice(1).every(worker => worker.terminated))
  worker.respond({ id, ok: true, value: 'serial prepared' })
  assert.equal(await pending, 'serial prepared')
  client.dispose()
}))

test('a new preparation terminates active helpers and ignores obsolete progress and replies', async () => withWorkers(async () => {
  const client = new IndirectLightingClient(), stages: string[] = []
  const old = client.prepare(largeRequest, progress => stages.push(progress.stage))
  const rejected = assert.rejects(old, /superseded/)
  const worker = FakeWorker.all[0], { id } = worker.messages[0]
  worker.respond({ id, progress: { stage: 'geometry', timings: {} } })
  worker.respond({ id, lampQuery: query })
  const obsolete = FakeWorker.all.slice()
  const current = client.prepare({ ...largeRequest, geometry: [] })
  await rejected
  worker.respond({ id, progress: { stage: 'geometry', timings: {} } })
  for (const helper of obsolete.slice(1)) helper.respond({ ok: true, data: new Float32Array(helper.messages[0].rowCount! * 4) })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(obsolete.every(worker => worker.terminated))
  assert.deepEqual(stages, ['geometry'])
  assert.equal(FakeWorker.all.length, 5, 'late progress does not create more helpers')
  const latest = FakeWorker.all.at(-1)!
  latest.respond({ id: latest.messages[0].id, ok: true, value: 'current prepared' })
  assert.equal(await current, 'current prepared')
  assert.equal(worker.messages.length, 1, 'obsolete helper results do not reach the replacement worker')
  client.dispose()
}))

test('an import failure before tracing rejects immediately and stops every helper', async () => withWorkers(async () => {
  const pool = new IndirectLampPool(3)
  FakeWorker.all[0].onerror?.({ message: 'import failed' })
  await assert.rejects(pool.trace(query), /closed/)
  assert.ok(FakeWorker.all.every(worker => worker.terminated))
}))
