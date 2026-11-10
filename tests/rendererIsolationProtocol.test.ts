import assert from 'node:assert/strict'
import test from 'node:test'
import { createCameraMailbox } from './browser/rendererIsolationProtocol.ts'
test('renderer mailbox bounds a blocked worker to one in-flight command and newest camera intent', () => {
  const sent: number[] = [], mailbox = createCameraMailbox(command => sent.push(command.id))
  for (let i = 0; i < 1000; i++) mailbox.update(i / 1000)
  assert.deepEqual(sent, [1]); assert.equal(mailbox.state().pending, 1000)
  mailbox.ack(4); assert.deepEqual(sent, [1], 'unrelated acknowledgements cannot unlock the queue')
  mailbox.ack(1); assert.deepEqual(sent, [1, 1000]); assert.equal(mailbox.state().pending, undefined)
  mailbox.clear(); mailbox.update(0); assert.deepEqual(sent, [1, 1000, 1001])
  mailbox.ack(1000); assert.equal(mailbox.state().inFlight, 1001, 'obsolete generation acknowledgement cannot clear a newer command')
})
