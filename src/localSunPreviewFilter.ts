/** Display denoising only: never changes transport/reference measurements.
 * Average neighbouring irradiance only on supported, nearby coplanar surfaces. */
export function filterLocalSunPreview(image:Float32Array,normals:Float32Array,positions:Float32Array,width:number,height:number,passes=1){
 if(image.length!==width*height*4||normals.length!==image.length||positions.length!==width*height*3)throw Error('Invalid preview filter dimensions')
 if(!Number.isInteger(passes)||passes<1||passes>4)throw Error('Invalid preview filter passes')
 let input=image,output=new Float32Array(image)
 for(let pass=0;pass<passes;pass++){
 const step=2**pass
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,a=i*4,p=i*3;if(normals[a+3]<.5)continue
  let weight=0,r=0,g=0,b=0
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx*step,yy=y+dy*step;if(xx<0||xx>=width||yy<0||yy>=height)continue
   const j=yy*width+xx,c=j*4,q=j*3;if(normals[c+3]<.5)continue
   if(normals[a]*normals[c]+normals[a+1]*normals[c+1]+normals[a+2]*normals[c+2]<.98)continue
   const vx=positions[q]-positions[p],vy=positions[q+1]-positions[p+1],vz=positions[q+2]-positions[p+2]
   if(vx*vx+vy*vy+vz*vz>Math.min(.5625,.0625*step*step)||Math.abs(vx*normals[a]+vy*normals[a+1]+vz*normals[a+2])>.015)continue
   // Wide passes must not jump over a doorway, unsupported pixel or wall.
   let connected=true
   for(let t=1;t<step;t++){
    const k=(y+dy*t)*width+x+dx*t,d=k*4,v=k*3
    if(normals[d+3]<.5||normals[a]*normals[d]+normals[a+1]*normals[d+1]+normals[a+2]*normals[d+2]<.98||Math.abs((positions[v]-positions[p])*normals[a]+(positions[v+1]-positions[p+1])*normals[a+1]+(positions[v+2]-positions[p+2])*normals[a+2])>.015){connected=false;break}
   }
   if(!connected)continue
   const w=(dx===0?2:1)*(dy===0?2:1);weight+=w;r+=input[c]*w;g+=input[c+1]*w;b+=input[c+2]*w
  }
  if(weight){output[a]=r/weight;output[a+1]=g/weight;output[a+2]=b/weight}
 }
 if(pass<passes-1){input=output;output=new Float32Array(input)}
 }
 return output
}
