import fs from 'node:fs'
import {DataUtils} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
const root='docs/sunlit-bounce',d=readLocalLightInput(`${root}/cache-sources.bin.gz`),input=readLocalLightInput(`${root}/reference-input.bin.gz`),data={...input.reference,skyBase:[0,0,0],skySun:[0,0,0],lights:[]},ref=createSceneLightingReference(data),results=[]
const decode=(a,o)=>[0,1,2].map(c=>DataUtils.fromHalfFloat(a[o+c])),normals=input.points.map(p=>p.normal),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),lum=a=>dot(a,[.2126,.7152,.0722]),basis=n=>[.28209479177387814,.4886025119029199*n[1],.4886025119029199*n[2],.4886025119029199*n[0]]
try{for(const tile of d.tiles){if(tile.position[1]<2.7||tile.position[0]<-1||tile.position[0]>5||tile.position[2]<9||tile.position[2]>16)continue
 const directions=[],weights=[],offsets=[];for(let face=0;face<6;face++)for(let y=0;y<d.size;y++)for(let x=0;x<d.size;x++){const u=-1+(x+.5)*2/d.size,v=1-(y+.5)*2/d.size,a=face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1],l=Math.hypot(...a);directions.push(a.map(v=>v/l));weights.push(4/l**3);offsets.push(((tile.faces[face][1]+y)*d.width+tile.faces[face][0]+x)*4)}
 const total=weights.reduce((s,v)=>s+v,0);weights.forEach((v,i)=>weights[i]=v/total*4*Math.PI)
 const r=ref.incoming(tile.position,directions,1,0,7351,true,1),groups=[]
 for(let category=1;category<=2;category++){
  const gpu=offsets.map(o=>lum(decode(d.solar,o))*DataUtils.fromHalfFloat(d.mask[o+category-1])),truth=r.map(p=>p.firstHit&&data.sourceCategories[p.firstHit.triangle]===category?lum(p.firstPass):0),coefs=[gpu,truth].map(a=>[0,1,2,3].map(k=>a.reduce((s,v,i)=>s+v*basis(directions[i])[k]*weights[i],0)))
  groups.push({category,gpuPixels:gpu.filter(v=>v>0).length,referencePixels:truth.filter(v=>v>0).length,gpuSolidAngle:offsets.reduce((s,o,i)=>s+DataUtils.fromHalfFloat(d.mask[o+category-1])*weights[i],0),gpuRadianceIntegral:dot(gpu,weights),referenceRadianceIntegral:dot(truth,weights),receivers:normals.map(n=>({gpuRaw:gpu.reduce((s,v,i)=>s+v*Math.max(0,dot(n,directions[i]))*weights[i],0),referenceRaw:truth.reduce((s,v,i)=>s+v*Math.max(0,dot(n,directions[i]))*weights[i],0),gpuL1:Math.max(0,coefs[0][0]*.886227+1.023328*dot(coefs[0].slice(1),[n[1],n[2],n[0]])),referenceL1:Math.max(0,coefs[1][0]*.886227+1.023328*dot(coefs[1].slice(1),[n[1],n[2],n[0]]))})),samples:offsets.flatMap((o,i)=>gpu[i]||truth[i]?[{direction:directions[i],weight:weights[i],gpu:gpu[i],reference:truth[i],mask:DataUtils.fromHalfFloat(d.mask[o+category-1]),receiver:Array.from(d.receiver.slice(o,o+4)),normal:Array.from(d.normal.slice(o,o+4)),response:decode(d.response,o),solar:decode(d.solar,o),firstHit:r[i].firstHit}]:[])})
 }
 results.push({index:tile.index,position:tile.position,groups});console.log('probe',tile.index,groups.map(g=>({category:g.category,gpu:g.gpuRadianceIntegral,reference:g.referenceRadianceIntegral})));fs.writeFileSync(`${root}/capture-audit.json`,JSON.stringify({receivers:input.points,results}))
}}finally{ref.dispose()}
