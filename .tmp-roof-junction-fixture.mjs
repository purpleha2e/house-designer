import {readFileSync,writeFileSync} from 'node:fs';
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8'));
writeFileSync('tests/fixtures/roofJoinRegression.json',JSON.stringify({floors:p.floors.map(({id,name,elevation,roomHeight,slabThickness,walls,roofs,floorFootprints})=>({id,name,elevation,roomHeight,slabThickness,walls:walls.map(w=>({...w,openings:[]})),roofs,floorFootprints,models:[],rooms:[]}))},null,2)+'\n');
