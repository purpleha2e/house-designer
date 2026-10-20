import assert from 'node:assert/strict'
import test from 'node:test'
import { houseSnapshotFilename } from '../scripts/build-viewer.mjs'

test('a changed house gets a new URL even when viewer code is unchanged', () => {
  const before = JSON.stringify({ floors: [{ models: [{ id: 'window', y: 1 }] }] })
  const after = JSON.stringify({ floors: [{ models: [{ id: 'window', y: 0.9 }] }] })
  assert.notEqual(houseSnapshotFilename(before), houseSnapshotFilename(after))
  assert.equal(houseSnapshotFilename(after), houseSnapshotFilename(after))
  assert.match(houseSnapshotFilename(after), /^house\.[a-f0-9]{20}\.json$/)
})
