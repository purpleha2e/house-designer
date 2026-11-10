import fs from 'node:fs'
import sharp from 'sharp'
import {DataUtils} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
const root='docs/sunlit-bounce',names=['gi-A','gi-B','gi-C','direct-sun','fill','gi-no-surface-sun','gi-sky-only','gi-sun-only'],images={},stats={}
for(const name of names){const d=readLocalLightInput(`${root}/${name}-hdr.bin.gz`);images[name]={data:Float32Array.from(d.pixels,DataUtils.fromHalfFloat),width:d.width,height:d.height}}
const a=images['gi-A'];for(const [name,b]of [['duvet-bounce','gi-B'],['wall-bounce','gi-C']])images[name]={...a,data:Float32Array.from(a.data,(v,i)=>i%4===3?1:v-images[b].data[i])}
for(const [name,d]of Object.entries(images)){
 const bytes=Buffer.alloc(d.width*d.height*3);let negative=0,clipped=0,max=0,sum=0
 for(let i=0;i<d.width*d.height;i++)for(let c=0;c<3;c++){const v=d.data[i*4+c];if(v<0)negative++;if(v*4>1)clipped++;max=Math.max(max,v);sum+=v;bytes[i*3+c]=Math.round(Math.min(1,Math.max(0,v*4))*255)}
 await sharp(bytes,{raw:{width:d.width,height:d.height,channels:3}}).flip().png().toFile(`${root}/${name}.png`);stats[name]={linearScale:4,max,mean:sum/(d.width*d.height*3),negativeChannels:negative,clippedChannels:clipped}
 if(name.endsWith('bounce')){for(let i=0;i<d.width*d.height;i++){const v=.2126*d.data[i*4]+.7152*d.data[i*4+1]+.0722*d.data[i*4+2],x=Math.min(1,Math.abs(v)*80);bytes[i*3]=Math.round(255*(v>=0?x:0));bytes[i*3+1]=Math.round(255*x*.45);bytes[i*3+2]=Math.round(255*(v<0?x:0))}await sharp(bytes,{raw:{width:d.width,height:d.height,channels:3}}).flip().png().toFile(`${root}/${name}-signed80.png`)}
}
fs.writeFileSync(`${root}/image-statistics.json`,JSON.stringify(stats,null,2))
