import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'

export type ExteriorEaveField = {
  min: number[]; size: number[]; dimensions: number[]; layers: number
  heightMin: number; heightRange: number; data: Uint8Array
}

/** Integrate the roof triangle over a grid texel instead of testing only its
 * centre. Binary samples produce a repeating coverage error along angled eaves. */
function clippedCellSample(triangle: number[][], x: number, z: number, half: number) {
  let polygon = triangle
  for (const [axis, boundary, side] of [[0,x-half,1],[0,x+half,-1],[2,z-half,1],[2,z+half,-1]]) {
    const output: number[][] = []
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length]
      const da=(a[axis]-boundary)*side,db=(b[axis]-boundary)*side
      if(da>=0)output.push(a)
      if((da>=0)!==(db>=0)) { const t=da/(da-db);output.push(a.map((v,j)=>v+(b[j]-v)*t)) }
    }
    polygon=output
    if(polygon.length<3)return null
  }
  let area=0,height=0
  const a=polygon[0]
  for(let i=1;i+1<polygon.length;i++) {
    const b=polygon[i],c=polygon[i+1]
    const weight=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))*.5
    area+=weight;height+=weight*(a[1]+b[1]+c[1])/3
  }
  return area>1e-12?{height:height/area,coverage:area/(4*half*half)}:null
}

/** Fine roof underside heights, independent of the coarse sky grid and its wall offset.
 * Each layer stores a distinct roof skin; lower porches must survive below a
 * main roof. RG encodes height and B coverage, allowing weighted filtering. */
export function bakeExteriorEaveField(parts: IndirectGeometrySnapshot): ExteriorEaveField | null {
  if (!parts.length) return null
  const visibility = createIndirectVisibilityFromSnapshot(parts)
  try {
    // The visibility builder reserves degenerate triangles for later refits.
    // Keep only downward-facing skins. Top and bottom faces of boxed trim
    // otherwise become separate overhead layers, making the fascia shadow
    // itself as coverage alternates along a diagonal edge of the height grid.
    const source = visibility.snapshot().positions, triangles: number[] = []
    for (let i = 0; i < source.length; i += 9) {
      const det = (source[i+5]-source[i+8])*(source[i]-source[i+6]) +
        (source[i+6]-source[i+3])*(source[i+2]-source[i+8])
      if (det < 1e-8) continue
      for (let j = 0; j < 9; j++) triangles.push(source[i+j])
    }
    const positions = triangles
    if (!positions.length) return null
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
    for(let i=0;i<positions.length;i+=3){minX=Math.min(minX,positions[i]);maxX=Math.max(maxX,positions[i]);minY=Math.min(minY,positions[i+1]);maxY=Math.max(maxY,positions[i+1]);minZ=Math.min(minZ,positions[i+2]);maxZ=Math.max(maxZ,positions[i+2])}
    // Reserve the complete cubic-filter footprint outside the roof, including
    // large buildings whose cells grow to keep the texture within 256 texels.
    const cell=Math.max(.08,(maxX-minX)/249,(maxZ-minZ)/249)
    minX-=3*cell;minZ-=3*cell;maxX+=3*cell;maxZ+=3*cell
    const nx=Math.ceil((maxX-minX)/cell-1e-8)+1,nz=Math.ceil((maxZ-minZ)/cell-1e-8)+1
    const heights=Array.from({length:nx*nz},()=>[] as {height:number;coverage:number}[])
    for(let i=0;i<positions.length;i+=9){
      const ax=positions[i],ay=positions[i+1],az=positions[i+2],bx=positions[i+3],by=positions[i+4],bz=positions[i+5],cx=positions[i+6],cy=positions[i+7],cz=positions[i+8]
      const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
      if(Math.abs(det)<1e-8)continue // Vertical fascia cannot be overhead cover.
      const x0=Math.max(0,Math.ceil((Math.min(ax,bx,cx)-minX)/cell-.5)),x1=Math.min(nx-1,Math.floor((Math.max(ax,bx,cx)-minX)/cell+.5))
      const z0=Math.max(0,Math.ceil((Math.min(az,bz,cz)-minZ)/cell-.5)),z1=Math.min(nz-1,Math.floor((Math.max(az,bz,cz)-minZ)/cell+.5))
      const triangle=[[ax,ay,az],[bx,by,bz],[cx,cy,cz]]
      const marginA=(Math.abs(bz-cz)+Math.abs(cx-bx))*cell*.5/Math.abs(det)
      const marginB=(Math.abs(cz-az)+Math.abs(ax-cx))*cell*.5/Math.abs(det)
      const marginC=(Math.abs(az-bz)+Math.abs(bx-ax))*cell*.5/Math.abs(det)
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const px=minX+x*cell,pz=minZ+z*cell
        const a=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/det,b=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/det,c=1-a-b
        if(a+marginA<0||b+marginB<0||c+marginC<0)continue
        const sample=a>=marginA&&b>=marginB&&c>=marginC
          ?{height:a*ay+b*by+c*cy,coverage:1}:clippedCellSample(triangle,px,pz,cell*.5)
        if(!sample)continue
        const list=heights[x+nx*z],near=list.find(entry=>Math.abs(entry.height-sample.height)<.06)
        if(!near)list.push(sample)
        else {
          const total=near.coverage+sample.coverage
          near.height=(near.height*near.coverage+sample.height*sample.coverage)/total
          near.coverage=total
        }
      }
    }
    const layers=heights.reduce((max,list)=>Math.max(max,list.length),1),heightRange=Math.max(.1,maxY-minY)
    const data=new Uint8Array(nx*nz*layers*4)
    heights.forEach((list,index)=>list.sort((a,b)=>a.height-b.height).forEach(({height,coverage},layer)=>{
      const value=Math.round((height-minY)/heightRange*65535),offset=(index+layer*nx*nz)*4
      data[offset]=value>>8;data[offset+1]=value&255;data[offset+2]=Math.round(Math.min(1,coverage)*255);data[offset+3]=255
    }))
    return{min:[minX,minZ],size:[(nx-1)*cell,(nz-1)*cell],dimensions:[nx,nz],layers,heightMin:minY,heightRange,data}
  }finally{visibility.dispose()}
}
