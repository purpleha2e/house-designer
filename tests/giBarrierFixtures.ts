import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {writeIndirectVolumeRow} from '../src/indirectVolume.ts'
import {writeIndirectFloorLayer} from '../src/indirectFloorLighting.ts'
export function barrierFixture(kind='thin-wall',thickness=.006){
 const storeys=/slab|stairwell/.test(kind),field=createIndirectField(Array.from({length:storeys?2:1},(_,i)=>({id:`floor${i}`,elevation:i*3,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]})),0),scene=new Scene(),material=new MeshStandardMaterial(),geometries=[]
 const box=(position:number[],size:number[])=>{const g=new BoxGeometry(...size as[number,number,number]),m=new Mesh(g,material);m.position.fromArray(position);scene.add(m);geometries.push(g);return m}
 const step=field.bounds.size/(field.floorLayer.n-1),left=field.bounds.minX+Math.round((2.5-field.bounds.minX)/step)*step,wallX=left+step/2
 let receiver=new Vector3(wallX-thickness/2-.001,.016,2),floorLayer=true
 const normal=new Vector3(0,1,0)
 if(kind==='doorway'||kind==='open-window'){box([wallX,1.4,.65],[thickness,2.8,1.3]);box([wallX,1.4,3.35],[thickness,2.8,1.3]);if(kind==='open-window'){box([wallX,.4,2],[thickness,.8,1.4]);floorLayer=false;receiver.y=1.4;normal.set(-1,0,0)}}
 else if(kind==='panel-edge')box([wallX,.8,2],[thickness,1.6,1.2])
 else if(storeys){const y=field.ranges[0].top-.12;receiver=new Vector3(2.3,y-thickness/2-.001,2);floorLayer=false;normal.set(0,-1,0);if(kind==='stairwell'){box([.4,y,2],[.8,thickness,4.4]);box([4.6,y,2],[.8,thickness,4.4])}else box([2.5,y,2],[5.4,thickness,4.4])}
 else box([wallX,1.4,2],[thickness,2.8,4.4])
 if(kind==='panel-edge')receiver.z=2.63
 // Two independent constant-radiance regions, matching the original 6 mm test.
 field.probes.splice(2);field.positionData.fill(0)
 field.probes.forEach((p,i)=>{p.position.set(storeys?2.3:i?3.7:2,storeys?receiver.y+(i?.7:-.7):.25,2);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1;field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat((i?1:.1)/.886227))})
 const mask=field.mask.image.data;for(let i=0;i<mask.length;i+=4)if(mask[i]){mask[i+1]=255;mask[i+2]=255}
 scene.updateMatrixWorld(true)
 return{field,scene,receiver,floorLayer,normal,wallX,thickness,step,dispose(){field.dispose();geometries.forEach(g=>g.dispose());material.dispose()}}
}
export function rebuildBarrierFixture(f:ReturnType<typeof barrierFixture>){
 const visibility=createIndirectVisibility(f.scene),values=new Float64Array(f.field.coefficientCount*3)
 writeIndirectFloorLayer(f.field,visibility)
 for(let row=0;row<f.field.volume.rows;row++)writeIndirectVolumeRow(f.field,row,values,visibility)
 return visibility
}
