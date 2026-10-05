import {readFileSync} from 'node:fs'
import {resolveBuildingRoofs} from './src/roofBuildingGeometry.ts'
import {getPitchedRoofHeightAtX,getGableRidgeX,getGableRidgeHeight,getRoofSlope} from './src/roofProfile.ts'
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
for(const candidate of resolveBuildingRoofs(p.floors).filter(r=>r.roof.id.startsWith('8e321')||r.roof.id.startsWith('b46c'))){
 const {roof,resolved:r,floorTopElevation}=candidate
 const datum=floorTopElevation+(roof.heightOffset??0)
 console.log(JSON.stringify({id:roof.id,wallTop:floorTopElevation,verticalOffset:roof.heightOffset??0,pitch:roof.pitchDegrees,
  ridgeOffset:roof.ridgeOffset,asymmetric:roof.asymmetricSides,ridgeHeightTarget:roof.ridgeHeightTargetRoofId,
  support:r.support,ridgeX:getGableRidgeX(roof,r.support),ridgeWorld:datum+getGableRidgeHeight(roof,r.support),
  supportSideHeights:[r.support.minX,r.support.maxX].map(x=>datum+getPitchedRoofHeightAtX(roof,r.support,x)),
  eaveHeights:[r.extents.minX,r.extents.maxX].map(x=>datum+getPitchedRoofHeightAtX(roof,r.support,x)),
  ridgeOffsetForSide1AtMount:(getGableRidgeHeight(roof,r.support)/getRoofSlope(roof.pitchDegrees))+r.support.minX,
  saved:p.floors.flatMap(f=>f.roofs??[]).find(r=>r.id===roof.id)
 },null,2))
}
