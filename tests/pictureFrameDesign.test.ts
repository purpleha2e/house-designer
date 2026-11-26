import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Raycaster, Vector3 } from 'three'
import { createPictureFrameDesign, getPictureFrameSize, pictureFrameDefinition, validatePictureFrameDesign } from '../src/pictureFrameDesign.ts'
import { createPictureFrameGeometry, disposePictureFrameGeometry } from '../src/pictureFrameGeometry.ts'
import { fitWallMountedObject, getModelOpenings } from '../src/modelPlacement.ts'
import type { Wall } from '../src/types.ts'

test('a picture frame uses the opening aspect ratio and adds both borders to its overall size', () => {
  const design = { ...createPictureFrameDesign(), openingWidth: .45, openingHeight: .6 }
  const size = getPictureFrameSize(design)
  assert.equal(validatePictureFrameDesign(design), null)
  assert.ok(Math.abs(size.width - .536) < 1e-9)
  assert.ok(Math.abs(size.height - .686) < 1e-9)
  assert.ok(validatePictureFrameDesign({ ...design, slipDepth: .04 }))
  assert.equal(validatePictureFrameDesign({ ...design, slipWidth: 0, slipDepth: 0 }), null)
})

test('the frame has an open centre, a recessed canvas and a back that can sit against a wall', () => {
  const design = createPictureFrameDesign()
  const definition = pictureFrameDefinition('custom-picture-frame', 'My picture frame', design)
  const group = createPictureFrameGeometry(design)
  try {
    const bounds = new Box3().setFromObject(group)
    const size = bounds.getSize(new Vector3())
    assert.ok(size.distanceTo(new Vector3(definition.width, definition.height, definition.depth)) < 1e-7)
    assert.ok(Math.abs(bounds.min.y) < 1e-7)
    const centreRay = new Raycaster(new Vector3(0, definition.height / 2, 1), new Vector3(0, 0, -1))
    const image = centreRay.intersectObject(group, true)[0]?.object
    assert.equal(image?.name, 'hd_image')
    assert.deepEqual(definition.materialRegions?.map(region => region.id), ['hd_frame', 'hd_slip', 'hd_image'])
    const slipRay = new Raycaster(new Vector3(design.openingWidth / 2 + design.slipWidth / 2, definition.height / 2, 1), new Vector3(0, 0, -1))
    assert.equal(slipRay.intersectObject(group, true)[0]?.object.name, 'hd_slip')
    assert.equal(definition.placement, 'wall-mounted')
    const wall: Wall = { id: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, kind: 'internal', height: 2.4, thickness: .1 }
    const mounted = fitWallMountedObject(definition, wall, { wallId: wall.id, offset: 2, side: 1 })
    assert.ok(mounted)
    assert.deepEqual(getModelOpenings({ id: 'frame', modelId: definition.id, scale: 1, ...mounted }, wall, new Map([[definition.id, definition]])), [])
  } finally {
    disposePictureFrameGeometry(group)
  }
})
