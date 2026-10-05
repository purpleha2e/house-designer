import {readFileSync,writeFileSync} from 'node:fs';
import {resolveBuildingRoofs} from './src/roofBuildingGeometry.ts';
import {buildBuildingRoofGables} from './src/roofGableGeometry.ts';
import {buildBuildingRoomVolumes} from './src/buildingRoomVolumes.ts';
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8'));
const roofs=resolveBuildingRoofs(p.floors), rooms=buildBuildingRoomVolumes(p.floors,roofs),gables=buildBuildingRoofGables(p.floors,roofs,rooms);
console.log(JSON.stringify(roofs.map(r=>({id:r.roof.id,pos:r.roof.position,connections:r.resolved.connections,abutments:r.abuttingWalls.map(a=>a.wall.id)})),null,2));
writeFileSync('.tmp-roof-junction-gables.json',JSON.stringify(gables));
console.log(JSON.stringify(gables.map(g=>({id:g.id,walls:g.walls.map(w=>w.wall.id),bounds:[0,1,2].map(i=>[Math.min(...g.faces.flatMap(f=>f.points.map(p=>p[i]))),Math.max(...g.faces.flatMap(f=>f.points.map(p=>p[i])))])})),null,2));
