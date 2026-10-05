import { readFileSync } from 'node:fs'
import { prepareRenderedFloorData } from './src/threeDLevelPreparation.ts'
import { buildFloorWallSurfaceFaces } from './src/wallEngine/floorWallSurfaceMesh.ts'
import { buildWallBodyPerimeters } from './src/wallEngine/wallBodyPerimeter.ts'
const project = JSON.parse(readFileSync('colin_house_v2.json', 'utf8'))
for (const data of project.floors.map(prepareRenderedFloorData)) {
 const faces = buildFloorWallSurfaceFaces({renderedWalls:data.renderedWalls,rooms:data.rooms,useWallBodyPerimeterMesh:true})
 console.log('Floor', data.floor.name, 'rooms',data.rooms.length,'faces',faces.length)
 const plan = buildWallBodyPerimeters(data.floor.walls)
 console.log('Perimeters',plan.perimeters.map(p=>({points:p.outline.length,holes:p.holes.map(h=>h.length),ids:p.wallIds.length})), 'diagnostics',plan.diagnostics)
 console.log(data.floor.walls.map(w=>({id:w.id,kind:w.kind,length:Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y),faces:faces.filter(f=>f.wallId===w.id).map(f=>f.kind)})))
}
