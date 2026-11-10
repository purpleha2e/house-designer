import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchDefaultProject } from '../src/projectBootstrap.ts'

test('default bootstrap fetches a separate JSON asset with cancellation rather than importing project data', async () => {
  const controller = new AbortController(), project = { activeFloorId: 'colin', floors: [{}] }
  const request = (async (url, init) => {
    assert.match(String(url), /colin_house_v2\.json$/)
    assert.equal(init?.signal, controller.signal)
    return new Response(JSON.stringify(project), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await fetchDefaultProject(controller.signal, request), project)
})
test('failed and aborted default loads never return a substitute project', async () => {
  await assert.rejects(fetchDefaultProject(new AbortController().signal, (async () => new Response('', { status: 503 })) as typeof fetch), /503/)
  await assert.rejects(fetchDefaultProject(new AbortController().signal, (async () => new Response('invalid JSON')) as typeof fetch), SyntaxError)
  const controller = new AbortController()
  const request = (async () => { controller.abort(); return new Response('{}') }) as typeof fetch
  await assert.rejects(fetchDefaultProject(controller.signal, request), { name: 'AbortError' })
})
