import assert from 'node:assert/strict'
import test from 'node:test'
import { houseSnapshotFilename, viewerModelDefinitions } from '../scripts/build-viewer.mjs'

test('a changed house gets a new URL even when viewer code is unchanged', () => {
  const before = JSON.stringify({ floors: [{ models: [{ id: 'window', y: 1 }] }] })
  const after = JSON.stringify({ floors: [{ models: [{ id: 'window', y: 0.9 }] }] })
  assert.notEqual(houseSnapshotFilename(before), houseSnapshotFilename(after))
  assert.equal(houseSnapshotFilename(after), houseSnapshotFilename(after))
  assert.match(houseSnapshotFilename(after), /^house\.[a-f0-9]{20}\.json$/)
})

test('an explicitly retired unresolved model stays absent without changing replacement definitions', () => {
  const retired = 'portal-model-old-stairs'
  const replacement = { id: 'custom-stairs-new', stairDesign: { name: 'My stairs' } }
  const ids = new Set([retired, replacement.id])
  const saved = [replacement]
  const catalog = [{ id: retired, sourceUrl: '/old.glb' }]
  assert.deepEqual(viewerModelDefinitions(ids, saved, catalog, [retired]), [replacement])
  assert.deepEqual(saved, [replacement])
  assert.throws(() => viewerModelDefinitions(ids, saved, []), /Missing model definition/)
  assert.throws(() => viewerModelDefinitions(ids, [...saved, catalog[0]], catalog, [retired]), /still defines it/)
  assert.throws(() => viewerModelDefinitions(ids, saved, catalog, ['portal-model-typo']), /referenced uploaded model/)
})
