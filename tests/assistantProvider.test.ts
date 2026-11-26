import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAiAssistant, validAssistantInput, type AssistantInput } from '../server/design-assistant.ts'
import { mockProvider } from '../src/assistant/intent.ts'

const input: AssistantInput = {
  prompt: 'Design three bedrooms and a bathroom upstairs', history: [], options: 0, previous: null, previousFloor: null,
  context: { projectId: 'house', revision: '1', units: 'metres', selectedFloorId: 'upper', selectedRoomSignature: null,
    floors: [{ id: 'upper', name: 'Upper floor', elevation: 2.7, footprintArea: 80, windows: 4, stairsFromBelow: 1, rooms: [] }] },
}

test('the live provider sends structured interpretation requests and validates the response', async () => {
  const interpretation = await mockProvider.interpret(input)
  const provider = createOpenAiAssistant('test-only-key', 'configured-model', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only-key')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'configured-model')
    assert.equal(body.store, false)
    assert.equal(body.text.format.strict, true)
    assert.equal(body.text.format.type, 'json_schema')
    assert.deepEqual(JSON.parse(body.input), input)
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(interpretation) }] }],
      usage: { input_tokens: 40, output_tokens: 32 } })
  })
  assert.deepEqual(await provider.interpret(input), interpretation)
  assert.equal(validAssistantInput(input), true)
  assert.equal(validAssistantInput({ ...input, prompt: 'x'.repeat(1001) }), false)
  assert.equal(validAssistantInput({ ...input, context: { ...input.context, mesh: [1, 2, 3] } }), false)
})

test('the live provider handles incomplete, refused and malformed replies', async () => {
  const responseProvider = (response: unknown) => createOpenAiAssistant('test-only-key', 'configured-model', async () => Response.json(response))
  await assert.rejects(responseProvider({ status: 'incomplete' }).interpret(input), /did not finish/)
  await assert.rejects(responseProvider({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }).interpret(input), /could not help/)
  await assert.rejects(responseProvider({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"walls":[]}' }] }] }).interpret(input), /unreadable reply/)
})
