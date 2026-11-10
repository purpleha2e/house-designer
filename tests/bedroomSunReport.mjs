import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import sharp from 'sharp'
import {DataUtils} from 'three'
const dir='docs/bedroom-sun-audit',meta=await sharp(`${dir}/baseline.png`).metadata(),width=meta.width,height=meta.height
const buffers=Object.fromEntries(['baseline','without-gi','without-fill'].map(name=>[name,new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${dir}/${name}.rgba16f.gz`))).buffer)]))
if(buffers.baseline.length!==width*height*4)throw Error('Unexpected HDR dimensions')
const regions={bed:[.35,.64,.72,.81],wall:[.5,.16,.75,.43],rightWall:[.86,.18,.95,.43]},summary={}
for(const [name,[x0,y0,x1,y1]] of Object.entries(regions)){
 const means={};for(const [mode,buffer] of Object.entries(buffers)){
  const rgb=[0,0,0];let pixels=0
  for(let y=Math.floor(y0*height);y<y1*height;y++)for(let x=Math.floor(x0*width);x<x1*width;x++){
   const i=((height-1-y)*width+x)*4;for(let c=0;c<3;c++)rgb[c]+=DataUtils.fromHalfFloat(buffer[i+c]);pixels++
  }
  means[mode]=rgb.map(v=>v/pixels)
 }
 const luminance=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722,base=luminance(means.baseline)
 summary[name]={rectangle:[x0,y0,x1,y1],linearRGB:means,giFraction:(base-luminance(means['without-gi']))/base,fillFraction:(base-luminance(means['without-fill']))/base}
}
const sun={};for(const name of ['first','second']){
 const r=JSON.parse(fs.readFileSync(`${dir}/${name}-sun.json`));sun[name]={elapsedMs:r.elapsedMs,shaderCompileCalls:r.compiles.length,programCountEnd:r.trace.at(-1).programs,warmingSamples:r.trace.filter(t=>t.gi.warming).length,capturedFaces:r.trace.at(-1).gi.capturedFaces,relitProbes:r.trace.at(-1).gi.surfaceRelitProbes}
}
fs.writeFileSync(`${dir}/summary.json`,JSON.stringify({width,height,regions:summary,sun},null,2));console.log(JSON.stringify({regions:summary,sun},null,2))
