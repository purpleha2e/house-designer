import {BoxGeometry,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,Scene,Vector3,type WebGLRenderer} from 'three'
import {createIndirectVisibility} from '../../src/indirectVisibility.ts'
import {captureDepth,depthVisible} from './giNextDepth.ts'

export async function depthFixtures(gl:WebGLRenderer){
  const results=[]
  for(const kind of ['thin-6mm','wall-100mm','wall-150mm','doorway','closed-door','two-storeys','stairwell','glazing','cushion-gap']){
    const scene=new Scene(),material=new MeshStandardMaterial(),owned:BoxGeometry[]=[],glass=new MeshPhysicalMaterial({transparent:true,opacity:.1,transmission:1})
    const box=(position:number[],size:number[],m=material)=>{const geometry=new BoxGeometry(...size as [number,number,number]);owned.push(geometry);const mesh=new Mesh(geometry,m);mesh.position.fromArray(position);scene.add(mesh)}
    const thickness=kind==='wall-100mm'?.1:kind==='wall-150mm'?.15:.006
    if(kind==='doorway'){box([0,1.4,-1.25],[.1,2.8,1.5]);box([0,1.4,1.25],[.1,2.8,1.5]);box([0,2.5,0],[.1,.6,1])}
    else if(kind==='stairwell'){box([-1.3,1.4,0],[1.4,.15,4]);box([1.3,1.4,0],[1.4,.15,4])}
    else if(kind==='two-storeys')box([0,1.4,0],[4,.15,4])
    else if(kind==='cushion-gap'){box([0,1,-.515],[.08,2,1]);box([0,1,.515],[.08,2,1])}
    else box([0,1.4,0],[thickness,2.8,4],kind==='glazing'?glass:material)
    const visibility=createIndirectVisibility(scene),vertical=/storeys|stairwell/.test(kind),probe={index:0,position:vertical?[0,.5,0]:[-1,1.1,.11]},origin=new Vector3().fromArray(probe.position)
    const points=Array.from({length:400},(_,i)=>vertical?[-1.9+(i%20)*.2,2.4,-1.9+Math.floor(i/20)*.2]:[1,.02+(i%20)*.14,-1.9+Math.floor(i/20)*.2])
    try{for(const size of [16,32,64,128]){
      const {cubes,metrics}=await captureDepth(gl,visibility,[probe],size),cube=cubes.get(0)!;let falseVisible=0,falseOccluded=0,visible=0,occluded=0,maxPixelCentreDepthError=0,pixelCentreMissMatches=0
      for(const p of points){const d=new Vector3().fromArray(p).sub(origin),distance=d.length(),expected=!visibility.occluded(origin,d.normalize(),distance-.0001,.0001),actual=depthVisible(cube,p);if(expected)visible++;else occluded++;if(actual&&!expected)falseVisible++;if(!actual&&expected)falseOccluded++}
      // Calibration uses actual cubemap texel-centre rays, away from silhouette
      // ties. It catches row flips, face orientation and radial-vs-Z depth bugs.
      for(let f=0;f<6;f++)for(let row=1;row<size;row+=7)for(let col=1;col<size;col+=7){const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(f===0?[1,v,-u]:f===1?[-1,v,u]:f===2?[u,1,-v]:f===3?[u,-1,v]:f===4?[u,v,1]:[-u,v,-1]).normalize(),expected=visibility.hit(origin,d,80,.0001)?.distance??80,actual=cube.faces[f][row*size+col];if((expected===80)!==(actual>=79.99))pixelCentreMissMatches++;if(expected<79.99&&actual<79.99)maxPixelCentreDepthError=Math.max(maxPixelCentreDepthError,Math.abs(expected-actual))}
      // Retain quantisation error rather than hiding a failed capture. Only
      // face-orientation/hit classification disagreement invalidates the run.
      if(pixelCentreMissMatches)throw Error(`Depth orientation calibration failed: ${kind}/${size}: ${pixelCentreMissMatches}`)
      results.push({kind,...metrics,visible,occluded,falseVisible,falseOccluded,maxPixelCentreDepthError,pixelCentreMissMatches})
    }}finally{visibility.dispose();owned.forEach(g=>g.dispose());material.dispose();glass.dispose()}
  }
  return results
}
