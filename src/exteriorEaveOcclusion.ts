import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'

export type ExteriorEaveField = {
  min: number[]; size: number[]; dimensions: number[]; layers: number
  heightMin: number; heightRange: number; data: Uint8Array
}

/** Fine roof heights, independent of the coarse sky grid and its wall offset.
 * Each layer stores a distinct roof skin; lower porches must survive below a
 * main roof. RG encodes height and B coverage, allowing weighted filtering. */
export function bakeExteriorEaveField(parts: IndirectGeometrySnapshot): ExteriorEaveField | null {
  if (!parts.length) return null
  const visibility = createIndirectVisibilityFromSnapshot(parts)
  try {
    // The visibility builder reserves degenerate triangles for later refits.
    // Exclude those (and vertical fascia) from roof bounds and rasterization.
    const source = visibility.snapshot().positions, triangles: number[] = []
    for (let i = 0; i < source.length; i += 9) {
      const det = (source[i+5]-source[i+8])*(source[i]-source[i+6]) +
        (source[i+6]-source[i+3])*(source[i+2]-source[i+8])
      if (Math.abs(det) < 1e-8) continue
      for (let j = 0; j < 9; j++) triangles.push(source[i+j])
    }
    const positions = triangles
    if (!positions.length) return null
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
    for(let i=0;i<positions.length;i+=3){minX=Math.min(minX,positions[i]);maxX=Math.max(maxX,positions[i]);minY=Math.min(minY,positions[i+1]);maxY=Math.max(maxY,positions[i+1]);minZ=Math.min(minZ,positions[i+2]);maxZ=Math.max(maxZ,positions[i+2])}
    minX-=.1;minZ-=.1;maxX+=.1;maxZ+=.1
    const cell=Math.max(.08,(maxX-minX)/255,(maxZ-minZ)/255)
    const nx=Math.ceil((maxX-minX)/cell)+1,nz=Math.ceil((maxZ-minZ)/cell)+1
    const heights=Array.from({length:nx*nz},()=>[] as number[])
    for(let i=0;i<positions.length;i+=9){
      const ax=positions[i],ay=positions[i+1],az=positions[i+2],bx=positions[i+3],by=positions[i+4],bz=positions[i+5],cx=positions[i+6],cy=positions[i+7],cz=positions[i+8]
      const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
      if(Math.abs(det)<1e-8)continue // Vertical fascia cannot be overhead cover.
      const x0=Math.max(0,Math.ceil((Math.min(ax,bx,cx)-minX)/cell)),x1=Math.min(nx-1,Math.floor((Math.max(ax,bx,cx)-minX)/cell))
      const z0=Math.max(0,Math.ceil((Math.min(az,bz,cz)-minZ)/cell)),z1=Math.min(nz-1,Math.floor((Math.max(az,bz,cz)-minZ)/cell))
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const px=minX+x*cell,pz=minZ+z*cell
        const a=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/det,b=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/det,c=1-a-b
        if(Math.min(a,b,c)<-1e-6)continue
        const y=a*ay+b*by+c*cy,list=heights[x+nx*z]
        const near=list.findIndex(height=>Math.abs(height-y)<.06)
        if(near<0)list.push(y);else list[near]=Math.min(list[near],y)
      }
    }
    const layers=heights.reduce((max,list)=>Math.max(max,list.length),1),heightRange=Math.max(.1,maxY-minY)
    const data=new Uint8Array(nx*nz*layers*4)
    heights.forEach((list,index)=>list.sort((a,b)=>a-b).forEach((height,layer)=>{
      const value=Math.round((height-minY)/heightRange*65535),offset=(index+layer*nx*nz)*4
      data[offset]=value>>8;data[offset+1]=value&255;data[offset+2]=255;data[offset+3]=255
    }))
    return{min:[minX,minZ],size:[(nx-1)*cell,(nz-1)*cell],dimensions:[nx,nz],layers,heightMin:minY,heightRange,data}
  }finally{visibility.dispose()}
}
