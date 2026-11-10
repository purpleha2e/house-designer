import fs from 'node:fs'
import {gunzipSync,gzipSync} from 'node:zlib'
import {DataUtils} from 'three'
import sharp from 'sharp'
const root='docs/soft-gi',modes=['baseline','5cm','10cm','20cm'],read=p=>JSON.parse(fs.readFileSync(p,'utf8')),raw=p=>new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync(p))).buffer),summary={}
for(const pose of ['original','moved','rotated']){
 const dir=`${root}/${pose}`,m=read(`${dir}/measurements.json`),g=read(`${dir}/graph.json`),valid=new Uint8Array(gunzipSync(fs.readFileSync(`${dir}/valid.gz`))),a=new Uint32Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${dir}/a.gz`))).buffer),b=new Uint32Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${dir}/b.gz`))).buffer),d2=new Float32Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${dir}/d2.gz`))).buffer),n=g.n,h=g.floors,step=g.step
 const offset=(cell,band)=>{const f=Math.floor(cell/n/n),q=cell%(n*n);return((Math.floor(q/n)*h*4+band*h+f)*n+q%n)*4}
 const rgb=modes.map(name=>{const data=raw(`${dir}/${name}.rgba16f.gz`),v=new Float32Array(valid.length*3);for(let i=0;i<valid.length;i++)if(valid[i])for(let c=0;c<3;c++)v[i*3+c]=Math.max(0,.886227*DataUtils.fromHalfFloat(data[offset(i,0)+c])+1.023328*DataUtils.fromHalfFloat(data[offset(i,1)+c]));return v})
 const regions={all:i=>true,door:i=>{const q=i%(n*n),x=m.dimensions.bounds.minX+q%n*step,z=m.dimensions.bounds.minZ+Math.floor(q/n)*step;return i<n*n&&x>.6&&x<2.5&&z>14.4&&z<15.8},stairs:i=>{const q=i%(n*n),x=m.dimensions.bounds.minX+q%n*step,z=m.dimensions.bounds.minZ+Math.floor(q/n)*step;return i<n*n&&x>3.2&&x<5.8&&z>14.6&&z<16.3}}
 const modesResult=modes.map((name,k)=>{
  const regionStats=Object.fromEntries(Object.entries(regions).map(([region,predicate])=>{
   const ids=[];for(let i=0;i<valid.length;i++)if(valid[i]&&predicate(i))ids.push(i)
   const selected=new Set(ids),maxGradient=[0,0,0],gradientSquare=[0,0,0],degree=new Uint8Array(valid.length),sum=new Float32Array(valid.length*3);let pairs=0
   for(let e=0;e<a.length;e++)if(d2[e]<=step*step*1.001&&selected.has(a[e])&&selected.has(b[e])){pairs++;for(let c=0;c<3;c++){const delta=rgb[k][a[e]*3+c]-rgb[k][b[e]*3+c];maxGradient[c]=Math.max(maxGradient[c],Math.abs(delta)/step);gradientSquare[c]+=delta*delta;sum[a[e]*3+c]+=rgb[k][b[e]*3+c];sum[b[e]*3+c]+=rgb[k][a[e]*3+c]}degree[a[e]]++;degree[b[e]]++}
   const average=[0,1,2].map(c=>ids.reduce((s,i)=>s+rgb[k][i*3+c],0)/ids.length),meanChange=[0,1,2].map(c=>ids.reduce((s,i)=>s+rgb[k][i*3+c]-rgb[0][i*3+c],0)/ids.length),laplacian=[0,1,2].map(c=>ids.filter(i=>degree[i]===4).reduce((s,i)=>s+Math.abs(rgb[k][i*3+c]-sum[i*3+c]/4),0)/Math.max(1,ids.filter(i=>degree[i]===4).length))
   const bins=new Map();for(const i of ids){const f=Math.floor(i/n/n),q=i%(n*n),x=q%n*step,z=Math.floor(q/n)*step,key=`${f}:${Math.floor(x/.5)}:${Math.floor(z/.5)}`;let p=bins.get(key);if(!p){p={n:0,old:[0,0,0],now:[0,0,0]};bins.set(key,p)}p.n++;for(let c=0;c<3;c++){p.old[c]+=rgb[0][i*3+c];p.now[c]+=rgb[k][i*3+c]}}
   const broad=[...bins.values()].filter(p=>p.n>=16),broadRMS=[0,1,2].map(c=>Math.sqrt(broad.reduce((s,p)=>s+((p.now[c]-p.old[c])/p.n)**2,0)/Math.max(1,broad.length)))
   const dark=ids.filter(i=>rgb[0][i*3]<.15),darkMeanChange=[0,1,2].map(c=>dark.reduce((s,i)=>s+rgb[k][i*3+c]-rgb[0][i*3+c],0)/Math.max(1,dark.length))
   return[region,{cells:ids.length,pairs,average,meanChange,maxGradient,edgeRMS:gradientSquare.map(s=>Math.sqrt(s/Math.max(1,pairs))),laplacian,broadRMS,darkCells:dark.length,darkMeanChange}]
  }))
  const refs=Object.fromEntries(['trace','grid','control'].map(kind=>{const points=m.results[k].points.filter(p=>p.kind===kind);return[kind,{n:points.length,maeRGB:[0,1,2].map(c=>points.reduce((s,p)=>s+Math.abs(p.values[0][c]-p.reference.sky[c]-p.reference.reflected[c]),0)/points.length)}]}))
  return{name,regions:regionStats,reference:refs,filter:m.results[k].statistics??null}
 })
 summary[pose]={modes:modesResult,preparation:m.graph,incremental:m.incremental,dimensions:m.dimensions}
 // Full floor overview: fixed linear red-irradiance scale, not scene brightness.
 const nx=240,nz=260,images=[];for(let k=0;k<4;k++){
  const pixels=Buffer.alloc(nx*nz*3);for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const wx=-.3+x/nx*7,wz=9+z/nz*9,ix=Math.round((wx-m.dimensions.bounds.minX)/step),iz=Math.round((wz-m.dimensions.bounds.minZ)/step),cell=iz*n+ix,idx=(z*nx+x)*3;if(!valid[cell]){pixels[idx]=pixels[idx+1]=pixels[idx+2]=220;continue}const v=Math.min(1,rgb[k][cell*3]/1.3);pixels[idx]=Math.round(25+225*v);pixels[idx+1]=Math.round(35+165*v);pixels[idx+2]=Math.round(65+70*v)}
  images.push({input:await sharp(pixels,{raw:{width:nx,height:nz,channels:3}}).png().toBuffer(),left:k*nx,top:30})
 }const label=Buffer.from(`<svg width="960" height="290"><rect width="960" height="290" fill="#fafafa"/>${modes.map((name,i)=>`<text x="${i*240+12}" y="21" font-family="Arial" font-size="14">${name} · linear GI red 0–1.3</text>`).join('')}</svg>`)
 await sharp(label).composite(images).png().toFile(`${dir}/floor-overview.png`)
}
fs.writeFileSync(`${root}/metrics.json`,JSON.stringify(summary,null,2))
// Signed linear-HDR image deltas are preserved losslessly, with a separate
// display visualization (zero=mid-grey, 1 unit=2040 byte levels).
const imageMetrics=[]
for(const pose of ['original','moved','rotated']){
 const dir=`${root}/${pose}`,baselines=fs.readdirSync(dir).filter(n=>n.endsWith('-baseline.png'))
 for(const file of baselines){const stem=file.slice(0,-'-baseline.png'.length),camera=read(`${dir}/${stem.split('-authored')[0].split('-white')[0]}-camera.json`),w=camera.width,h=camera.height,base=raw(`${dir}/${stem}-baseline.rgba16f.gz`),panels=[]
  for(const name of modes){panels.push({input:await sharp(`${dir}/${stem}-${name}.png`).resize(655,444).toBuffer(),left:modes.indexOf(name)%2*655,top:32+Math.floor(modes.indexOf(name)/2)*476});if(name==='baseline')continue
   const data=raw(`${dir}/${stem}-${name}.rgba16f.gz`),delta=new Float32Array(w*h*3),display=Buffer.alloc(w*h*3),sum=[0,0,0],absolute=[0,0,0];let max=0
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){const i=((h-1-y)*w+x)*4+c,j=(y*w+x)*3+c,v=DataUtils.fromHalfFloat(data[i])-DataUtils.fromHalfFloat(base[i]);delta[j]=v;display[j]=Math.max(0,Math.min(255,128+Math.round(v*2040)));sum[c]+=v;absolute[c]+=Math.abs(v);max=Math.max(max,Math.abs(v))}
   fs.writeFileSync(`${dir}/${stem}-${name}-difference.rgb32f.gz`,gzipSync(Buffer.from(delta.buffer)))
   await sharp(display,{raw:{width:w,height:h,channels:3}}).png().toFile(`${dir}/${stem}-${name}-difference.png`)
   imageMetrics.push({pose,view:stem,name,width:w,height:h,meanSignedRGB:sum.map(v=>v/w/h),meanAbsoluteRGB:absolute.map(v=>v/w/h),maxAbsolute:max,displayScale:2040})
  }
  const labels=Buffer.from(`<svg width="1310" height="952"><rect width="1310" height="952" fill="#fafafa"/>${modes.map((name,i)=>`<text x="${i%2*655+14}" y="${Math.floor(i/2)*476+23}" font-family="Arial" font-size="18">${name}</text>`).join('')}</svg>`)
  await sharp(labels).composite(panels).png().toFile(`${dir}/${stem}-comparison.png`)
 }
}
fs.writeFileSync(`${root}/image-metrics.json`,JSON.stringify(imageMetrics,null,2));console.log('generated',imageMetrics.length,'HDR comparisons')
