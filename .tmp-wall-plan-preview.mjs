import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { buildWallBodyPerimeters } from './src/wallEngine/wallBodyPerimeter.ts'
import { prepareRenderedFloorData } from './src/threeDLevelPreparation.ts'

const floor = JSON.parse(readFileSync('floor_test.json', 'utf8')).floors[0]
const walls = prepareRenderedFloorData(floor).renderedWalls.map(({ wall }) => wall)
const scale = 210
const ringPath = (ring) => ring.map((point, index) =>
  `${index === 0 ? 'M' : 'L'}${(point.x - 2.7) * scale},${(point.y - 8.3) * scale}`,
).join(' ') + ' Z'
const plan = buildWallBodyPerimeters(walls)
const paths = plan.perimeters.map((perimeter) =>
  `<path d="${[perimeter.outline, ...perimeter.holes].map(ringPath).join(' ')}" fill="#aab4bf" stroke="#334155" stroke-width="1.5" stroke-linejoin="miter"/>`,
).join('\n')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650" viewBox="0 0 800 650"><rect width="800" height="650" fill="#f8fafc"/>${paths}</svg>`
await sharp(Buffer.from(svg)).png().toFile('.tmp-wall-plan-preview.png')
console.log(JSON.stringify({ diagnostics: plan.diagnostics, perimeters: plan.perimeters.length, holes: plan.perimeters.map((perimeter) => perimeter.holes.length) }))
