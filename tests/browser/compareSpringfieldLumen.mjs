import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const folder = new URL('../../docs/lumen-gi/', import.meta.url)
const read = async name => JSON.parse(await readFile(new URL(name, folder), 'utf8'))
const [{ captures }, production, { reference }] = await Promise.all([
  read('lumen.json'), read('production.json'), read('reference.json')
])
const projectHash=createHash('sha256').update(await readFile(new URL('../../springfield_14.json',folder))).digest('hex')
assert.equal(projectHash,(await read('baseline.json')).sha256)
const images = {
  'landing-off': captures['landing-off'],
  'landing-production': production.captures['landing-production'],
  'landing-lumen': captures['landing-lumen']
}
for (const [name, image] of Object.entries(images)) {
  assert.deepEqual(image.camera, reference.camera, name + ' camera')
  assert.deepEqual(image.projection, reference.projection, name + ' projection')
  assert.deepEqual(image.sun, reference.inputs, name + ' daylight')
  assert.equal(image.exposure, reference.exposure, name + ' exposure')
  assert.equal(image.indoorFill, 0, name + ' ambient fill')
  assert.equal(image.toneMapping, 'ACESFilmic composer')
}
assert.equal(reference.toneMapping, 'ACESFilmic')
assert.deepEqual(reference.inputs.lights, [])
assert.equal(images['landing-production'].production, 'ready')
assert.equal(images['landing-lumen'].production, 'suspended')
assert.equal(images['landing-off'].diffuseComposited, 1)
assert.equal(images['landing-lumen'].diffuseComposited, 1)

// Rectangles are in the matched landing image. Average a broad area so
// individual noisy pixels in the path tracer do not determine the result.
const regions = {
  ceiling: { left: 450, top: 20, width: 450, height: 105 },
  leftWall: { left: 35, top: 225, width: 310, height: 450 },
  windowWall: { left: 520, top: 445, width: 320, height: 80 },
  rightWall: { left: 1020, top: 80, width: 185, height: 200 }
}
const summary = {}
for (const name of [...Object.keys(images), 'landing-reference', 'landing-off-screen-carpet-bounce', 'landing-window-daylight']) {
  const image = sharp(fileURLToPath(new URL(name + '.png', folder)))
  const size = await image.metadata()
  assert.equal(size.width, reference.width)
  assert.equal(size.height, reference.height)
  summary[name] = {}
  for (const [label, region] of Object.entries(regions)) {
    const { data, info } = await image.clone().extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let total = 0
    for (let i = 0; i < data.length; i += info.channels) {
      total += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]
    }
    summary[name][label] = +(total / (region.width * region.height)).toFixed(2)
  }
}
await writeFile(new URL('comparison.json', folder), JSON.stringify({
  projectHash, exposure: reference.exposure, artificialLights: 0, toneMapping: reference.toneMapping,
  regions, units: 'mean display-referred sRGB luma, 0–255', luma: summary
}, null, 2) + '\n')
console.table(summary)
