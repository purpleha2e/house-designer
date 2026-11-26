import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getModelMaterialOverrideId,
  getModelMaterialRegion,
  getModelMaterialTextureTransform,
  discoverHdMaterialRegions,
  migrateArtworkMaterial,
  normalizeArtworkMaterialRegions,
} from '../src/modelMaterialOverrides.ts'

test('hd_ names opt into stable editable regions without merging distinct authored slots', () => {
  const found = discoverHdMaterialRegions(['hd_frame','paint','hd_drawer_fronts','hd_frame','HD_Glass', 'hd_frame.001','hd_', 'hd_  ', 'hd_door-leaf','hd_door_leaf'])
  assert.deepEqual(found.map(r=>[r.id,r.label]), [['hd_frame','Frame'],['hd_drawer_fronts','Drawer fronts'],['HD_Glass','Glass'],['hd_frame.001','Frame.001'],['hd_door-leaf','Door leaf'],['hd_door_leaf','Door leaf']])
  assert.equal(getModelMaterialOverrideId({'hd_frame':'oak'},found,'hd_frame'),'oak')
  assert.equal(getModelMaterialOverrideId({'hd_frame':'oak'},found,'hd_frame.001'),undefined)
  assert.equal(getModelMaterialOverrideId({'hd_frame':'oak'},found,'paint'),undefined)
})

test('object material texture mapping reads each slot independently and tolerates old or invalid saves', () => {
  const transforms = {
    hd_upholstery: { textureScale: .5, textureRotation: -90 },
    hd_legs: { textureScale: 0, textureRotation: Number.NaN },
  }
  assert.deepEqual(getModelMaterialTextureTransform(undefined, 'hd_upholstery'), {})
  assert.deepEqual(getModelMaterialTextureTransform(transforms, 'hd_upholstery'), { textureScale: .5, textureRotation: 270 })
  assert.deepEqual(getModelMaterialTextureTransform(transforms, 'hd_legs'), {})
  assert.deepEqual(getModelMaterialTextureTransform(transforms, 'hd_pillows'), {})
})

test('older artwork keeps its image and mapping under the new slot without changing unrelated canvas materials', () => {
  const artwork = discoverHdMaterialRegions(['hd_frame', 'hd_canvas'])
  const normalized = normalizeArtworkMaterialRegions(artwork, 'decor')
  assert.deepEqual(migrateArtworkMaterial({ hd_canvas: 'painting', hd_frame: 'oak' }), { hd_image: 'painting', hd_frame: 'oak' })
  assert.deepEqual(migrateArtworkMaterial({ hd_canvas: { textureRotation: 90 } }), { hd_image: { textureRotation: 90 } })
  assert.equal(getModelMaterialOverrideId({ hd_image: 'painting' }, normalized, 'hd_canvas'), 'painting')
  assert.equal(getModelMaterialOverrideId({ hd_image: 'painting' }, normalized, 'hd_image'), 'painting')
  assert.equal(normalizeArtworkMaterialRegions(artwork, 'furniture'), artwork)
  const explicitlySeparate = discoverHdMaterialRegions(['hd_frame', 'hd_canvas', 'hd_image'])
  assert.equal(normalizeArtworkMaterialRegions(explicitlySeparate, 'decor'), explicitlySeparate)
})

const regions = [
  {
    id: 'stairs_steps',
    label: 'Steps',
    sourceMaterialNames: ['stairs_steps'],
  },
  {
    id: 'stairs_woodwork',
    label: 'Wood',
    sourceMaterialNames: [
      'stairs_woodwork',
      'stairs_banister',
      'stairs_spindles',
    ],
  },
]

test('maps exported stair materials to their semantic region', () => {
  assert.equal(getModelMaterialRegion(regions, 'stairs_steps')?.id, 'stairs_steps')
  assert.equal(
    getModelMaterialRegion(regions, 'stairs_banister')?.id,
    'stairs_woodwork',
  )
  assert.equal(getModelMaterialRegion(regions, 'unassigned'), undefined)
})

test('uses one wood override for woodwork, banister, and spindles', () => {
  const overrides = {
    stairs_steps: 'carpet',
    stairs_woodwork: 'oak',
  }

  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'stairs_steps'),
    'carpet',
  )
  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'stairs_spindles'),
    'oak',
  )
  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'steps_spindles'),
    undefined,
  )
})
