import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { prepareViewerFloors } from '../src/viewer/viewerFloors.ts'
import { indirectProjectKey } from '../src/indirectLightingPersistence.ts'
import type { PublishedHouse } from '../src/viewer/viewerProject.ts'

test('published saved geometry keeps its lighting key without browser-dependent opening recalculation', () => {
  const project = JSON.parse(readFileSync(new URL('../colin_house_v2.json', import.meta.url), 'utf8')) as PublishedHouse['project']
  assert.ok(project.indirectLighting)
  const original = JSON.stringify(project.floors)
  // An incomplete runtime registry must not remove saved window openings.
  // The renderer's normal asset validation still runs independently.
  const floors = prepareViewerFloors(project, new Map())
  assert.equal(indirectProjectKey({ ...project, floors }), indirectProjectKey(project))
  assert.equal(JSON.stringify(project.floors), original)
  for (const floor of floors) assert.equal(floor, project.floors.find(saved => saved.id === floor.id))
})
