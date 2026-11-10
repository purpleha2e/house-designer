import test from 'node:test'
import assert from 'node:assert/strict'
import { recoveryShadowMode, recoveryShadowSize } from '../src/rendererRecovery.ts'

test('recovery defaults to the existing single shadow map', () => {
  assert.equal(recoveryShadowMode('',true),'single')
  assert.equal(recoveryShadowMode('?rendererShadows=invalid',true),'single')
})
test('only an explicit development comparison enables cascades or disables shadows', () => {
  assert.equal(recoveryShadowMode('?rendererShadows=cascaded',true),'cascaded')
  assert.equal(recoveryShadowMode('?rendererShadows=off',true),'off')
  assert.equal(recoveryShadowMode('?rendererShadows=cascaded',false),'single')
  assert.equal(recoveryShadowMode('?rendererShadows=off',false),'single')
})
test('shadow-size comparison is diagnostic only',()=>{
  assert.equal(recoveryShadowSize('',true),2048)
  assert.equal(recoveryShadowSize('?rendererShadowSize=1024',true),1024)
  assert.equal(recoveryShadowSize('?rendererShadowSize=1024',false),2048)
})
