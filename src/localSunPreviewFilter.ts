/** Display denoising only: never changes transport/reference measurements.
 * Average neighbouring irradiance only on supported, nearby coplanar surfaces. */
export function filterLocalSunPreview(image:Float32Array,normals:Float32Array,positions:Float32Array,width:number,height:number){
 if(image.length!==width*height*4||normals.length!==image.length||positions.length!==width*height*3)throw Error('Invalid preview filter dimensions')
 const output=new Float32Array(image)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,a=i*4,p=i*3;if(normals[a+3]<.5)continue
  let weight=0,r=0,g=0,b=0
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue
   const j=yy*width+xx,c=j*4,q=j*3;if(normals[c+3]<.5)continue
   if(normals[a]*normals[c]+normals[a+1]*normals[c+1]+normals[a+2]*normals[c+2]<.98)continue
   const vx=positions[q]-positions[p],vy=positions[q+1]-positions[p+1],vz=positions[q+2]-positions[p+2]
   if(vx*vx+vy*vy+vz*vz>.0625||Math.abs(vx*normals[a]+vy*normals[a+1]+vz*normals[a+2])>.015)continue
   const w=(dx===0?2:1)*(dy===0?2:1);weight+=w;r+=image[c]*w;g+=image[c+1]*w;b+=image[c+2]*w
  }
  if(weight){output[a]=r/weight;output[a+1]=g/weight;output[a+2]=b/weight}
 }
 return output
}
