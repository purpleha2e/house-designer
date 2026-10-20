import assert from 'node:assert/strict'
import test from 'node:test'
import { createWallMessageReceiver, wallWorkerMessages, WALL_MESSAGE_FACE_LIMIT, type WallWorkerJob } from '../src/wallEngine/wallWorkerMessages.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import type { WallRoofClipInputJob } from '../src/wallEngine/wallRoofClipJob.ts'

test('large wall jobs round trip through bounded browser messages with shared clipping faces intact', () => {
  const faces = Array.from({ length: 1200 }, (_, i) => ({ wallId: `wall-${i}`, vertices: [{ position: [i, 2, 3], uv: [4, 5] }] })) as WallMeshFace[]
  for (const wallFaces of [faces, faces.slice(0, 400), undefined]) {
    const job = { faces, input: { floorElevation: 0, roofs: [], roomPolygons: [], wallFaces } } as WallRoofClipInputJob
    const receiver = createWallMessageReceiver()
    let result: WallWorkerJob | undefined
    for (const message of wallWorkerMessages(job)) {
      if ('stream' in message && message.stream === 'faces') assert.ok(message.faces.length <= WALL_MESSAGE_FACE_LIMIT)
      result = receiver(structuredClone(message)) ?? result
    }
    assert.deepEqual(result, job)
    if (wallFaces === faces) assert.equal((result as WallRoofClipInputJob).input.wallFaces, result!.faces)
    assert.equal(job.faces.length, 1200, 'sending never changes live geometry')
  }
})

test('small jobs need no streaming setup and incomplete jobs are not executed', () => {
  const job = { kind: 'render', faces: [], walls: [], surfaceAssignments: [], floorId: 'ground', elevation: 0 } as const
  const receiver = createWallMessageReceiver()
  const mutable = { ...job, faces: [], walls: [], surfaceAssignments: [] } as WallWorkerJob
  assert.deepEqual([...wallWorkerMessages(mutable)], [mutable])
  assert.equal(receiver({ stream: 'start', job: mutable, sharedWallFaces: false }), undefined)
  assert.equal(receiver({ stream: 'faces', field: 'faces', faces: [] }), undefined)
  assert.equal(receiver({ stream: 'end' }), mutable)
})
