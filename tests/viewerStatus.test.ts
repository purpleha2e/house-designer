import test from 'node:test'
import assert from 'node:assert/strict'
import { formatViewerStatus } from '../src/viewer/viewerStatus.ts'

test('tour stays busy until both the scene and lighting have finished', () => {
  assert.equal(formatViewerStatus('Loading models and textures...', { state: 'ready' }), 'Loading models and textures...')
  assert.equal(formatViewerStatus(null), 'Preparing lighting...')
  assert.equal(formatViewerStatus(null, { state: 'loading' }), 'Loading saved lighting...')
  assert.equal(formatViewerStatus(null, { total: 10, completed: 4 }), 'Calculating lighting... 40%')
  assert.equal(formatViewerStatus(null, { state: 'ready', volumePending: true, total: 10, completed: 10 }), 'Calculating lighting... 99%')
  assert.equal(formatViewerStatus(null, { state: 'ready', pendingUpdate: true }), 'Calculating lighting...')
  assert.equal(formatViewerStatus(null, { state: 'ready', floorPreparing: true }), 'Preparing floor lighting...')
  assert.equal(formatViewerStatus(null, { state: 'ready', source: 'saved', xr: true }), 'Scene ready.')
})

test('tour explains paused or unavailable lighting without claiming to be calculating', () => {
  assert.equal(formatViewerStatus(null, { paused: true }), 'Lighting paused while moving...')
  assert.equal(formatViewerStatus(null, { xr: true }), 'Lighting paused during VR.')
  assert.equal(formatViewerStatus(null, { enabled: false }), 'Scene ready.')
  assert.equal(formatViewerStatus(null, { state: 'fallback' }), 'Scene ready. Indirect lighting unavailable.')
  assert.equal(formatViewerStatus(null, { state: 'fallback', cacheReason: 'Saved lighting does not match the house.' }),
    'Scene ready. Saved lighting does not match the house.')
})
