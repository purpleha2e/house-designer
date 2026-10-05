import {readFileSync,writeFileSync} from 'node:fs';
import {resolveBuildingRoofs} from './src/roofBuildingGeometry.ts';
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8'));
const floor=p.floors[1],source=floor.roofs.find(r=>r.id==='b9c4f4d7-2ea6-4bc2-8b59-481280115509');
source.ridgeEnd={mode:'join',targetRoofId:'b46c5b90-ecdc-4d0f-a6a5-976b793c7270'};
const r=resolveBuildingRoofs(p.floors).find(r=>r.roof.id===source.id);
console.log(JSON.stringify({roofId:source.id,connections:r.resolved.connections,extents:r.resolved.extents,resolvedExtents:r.resolved.resolvedExtents}));
writeFileSync('.tmp-roof-gable-join-preview.json',JSON.stringify(p));
