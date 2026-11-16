import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseProjectSaveFile, writeProjectFile } from '../src/projectDeviceSave.ts'

test('Save As invokes the picker immediately and returns the selected file', async () => {
  let invoked = false
  const handle = { name: 'chosen.house.json', createWritable: async () => { throw Error('not writing yet') } }
  const selection = chooseProjectSaveFile('house.house.json', { showSaveFilePicker: async options => {
    invoked = true
    assert.equal(options.suggestedName, 'house.house.json')
    assert.deepEqual(options.types[0].accept, { 'application/json': ['.json'] })
    return handle
  } })
  assert.ok(invoked, 'preserves the button click user activation')
  assert.equal(await selection, handle)
  await assert.rejects(chooseProjectSaveFile('house.json', {}), /Save As dialog is not available/)
})

test('cancelling a stalled picker rejects it and ignores a late selection', async () => {
  const controller = new AbortController()
  let finish!: (handle: never) => void
  const selection = chooseProjectSaveFile('house.json', { showSaveFilePicker: () => new Promise(resolve => { finish = resolve }) }, controller.signal)
  controller.abort()
  await assert.rejects(selection, { name: 'AbortError' })
  finish({} as never)
  await assert.rejects(selection, { name: 'AbortError' })
})

test('saving waits for close and aborts failed writes without committing them', async () => {
  const calls: string[] = []
  let release!: () => void
  const handle = { name: 'chosen.json', createWritable: async () => ({
    write: async (text: string) => { calls.push(text) },
    close: () => new Promise<void>(resolve => { calls.push('closing'); release = resolve }),
    abort: async () => { calls.push('abort') },
  }) }
  let saved = false
  const saving = writeProjectFile(handle, 'contents').then(() => { saved = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['contents', 'closing']); assert.equal(saved, false)
  release(); await saving; assert.equal(saved, true)
  await assert.rejects(writeProjectFile({ name: 'bad.json', createWritable: async () => ({
    write: async () => { throw Error('Disk full') }, close: async () => { calls.push('incorrect close') },
    abort: async () => { calls.push('abort') },
  }) }, 'contents'), /Disk full/)
  assert.deepEqual(calls, ['contents', 'closing', 'abort'])
})
