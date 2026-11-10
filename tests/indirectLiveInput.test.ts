import assert from 'node:assert/strict'
import test from 'node:test'
import { createIndirectLiveInput, sameIndirectLightLayout } from '../src/indirectLiveInput.ts'
import type { IndirectLocalLight } from '../src/components/IndirectLighting.tsx'

const light: IndirectLocalLight = {kind:'point',position:[1,2,3],target:[1,1,3],color:'#ffffff',power:10,distance:5,falloff:2,angle:1,penumbra:.5}
test('immediate lamp inputs coalesce identical state and unsubscribe cleanly', () => {
  const input=createIndirectLiveInput();let updates=0
  const stop=input.subscribe(()=>updates++)
  input.set([light]);const first=input.get()
  input.set([{...light}]);assert.equal(input.get(),first);assert.equal(updates,1)
  input.set([{...light,power:0}]);assert.equal(updates,2);assert.equal(input.get().lights[0].power,0)
  stop();input.set([light]);assert.equal(updates,2)
})
test('only compatible lamp layouts can bypass deferred scene and visibility preparation', () => {
  assert.equal(sameIndirectLightLayout([{...light,power:0,color:'#ff0000',angle:.2,distance:2}],[light]),true)
  assert.equal(sameIndirectLightLayout([{...light,position:[2,2,3]}],[light]),false)
  assert.equal(sameIndirectLightLayout([{...light,kind:'spot'}],[light]),false)
  assert.equal(sameIndirectLightLayout([], [light]),false)
})
