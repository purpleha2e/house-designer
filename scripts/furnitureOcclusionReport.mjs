import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import sharp from 'sharp'
import {DataUtils} from 'three'

const root='docs/furniture-occlusion',read=path=>existsSync(`${root}/${path}`)?JSON.parse(readFileSync(`${root}/${path}`)):null
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,reference=p=>p.reference.sky.map((v,c)=>v+p.reference.reflected[c])
const summary=a=>({n:a.length,rmse:Math.sqrt(mean(a.map(v=>v*v))),maxAbsolute:Math.max(...a.map(Math.abs)),signedMean:mean(a)})
const cases=[['A','A-fresh/reference.json'],['B','B-restored/reference.json'],['C','C-fresh-removed/reference.json'],['10cm','move-10cm/reference.json'],['20cm','move-20cm/reference.json']].map(([name,path])=>({name,data:read(path)})).filter(c=>c.data)
const top=read('A-fresh/wall-profile.json').top
const budget=cases.map(({name,data})=>{
 const points=data.results.map(p=>({...p,heightAboveWorktop:p.position[1]-top,referenceIndirect:reference(p),stageDeltas:{reconstruction:p.preFilterAtSurface.rgb.map((v,c)=>v-reference(p)[c]),receiverOffset:p.preFilterAtShaderPosition.rgb.map((v,c)=>v-p.preFilterAtSurface.rgb[c]),textureFiltering:p.shaderIrradiance.map((v,c)=>v-p.preFilterAtShaderPosition.rgb[c]),total:p.shaderIrradiance.map((v,c)=>v-reference(p)[c])}}))
 const groups=Object.fromEntries([['all',()=>true],['exposed',p=>p.heightAboveWorktop>=0],['nearJunction',p=>p.heightAboveWorktop>=0&&p.heightAboveWorktop<=.12],['belowWorktop',p=>p.heightAboveWorktop<0]].map(([name,filter])=>[name,Object.fromEntries(['reconstruction','receiverOffset','textureFiltering','total'].map(stage=>[stage,summary(points.filter(filter).flatMap(p=>p.stageDeltas[stage]))]))]))
 return{name,groups,points,probeAttribution:data.probes}
})
writeFileSync(`${root}/error-budget.json`,JSON.stringify({units:'linear scene-relative RGB diffuse irradiance',method:'Signed telescoping differences. Reconstruction includes capture, directional compression and spatial interpolation; probe-atlas evidence further separates these at selected probes. RMSE pools RGB channels; differences are correlated and must not be added as independent variances.',cases:budget},null,2))
const B=cases.find(c=>c.name==='B')?.data,C=cases.find(c=>c.name==='C')?.data
if(B&&C){
 const incremental=read('B-incremental/incremental-field-cache.json'),fresh=read('C-fresh-removed/field-cache.json'),keys=['projectKey','assetKey','geometryKey']
 for(const key of keys)assert.equal(incremental[key],fresh[key],key)
 assert.deepEqual(incremental.settings,fresh.settings);assert.equal(B.results.length,C.results.length)
 for(let i=0;i<B.results.length;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(B.results[i].position[c]-C.results[i].position[c])<1e-5,'same wall receiver')
 writeFileSync(`${root}/incremental-vs-fresh.json`,JSON.stringify({sameGeometry:true,verifiedKeys:Object.fromEntries(keys.map(key=>[key,incremental[key]])),sameSettings:true,gpuIrradiance:summary(B.results.flatMap((p,i)=>p.shaderIrradiance.map((v,c)=>v-C.results[i].shaderIrradiance[c]))),points:B.results.map((p,i)=>({height:p.position[1],incremental:p.shaderIrradiance,fresh:C.results[i].shaderIrradiance,reference:reference(C.results[i])}))},null,2))
}

// Standalone vector plots preserve the numerical axis values in exported files.
function plot(name,title,series,xLabel,yLabel){
 const w=1000,h=560,l=88,t=70,r=35,b=82,all=series.flatMap(s=>s.points),xmin=Math.min(...all.map(p=>p[0])),xmax=Math.max(...all.map(p=>p[0])),ymin=0,ymax=Math.max(.1,...all.map(p=>p[1]+(p[2]??0)))*1.08
 const x=v=>l+(v-xmin)/(xmax-xmin)*(w-l-r),y=v=>h-b-(v-ymin)/(ymax-ymin)*(h-t-b),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" font-size="15" fill="#263238"><text x="${l}" y="28" font-size="21">${escape(title)}</text>`
 for(let i=0;i<=5;i++){const yy=y(ymax*i/5),xx=x(xmin+(xmax-xmin)*i/5);svg+=`<path d="M${l} ${yy}H${w-r}" stroke="#e0e5e9"/><text x="${l-12}" y="${yy+5}" text-anchor="end">${(ymax*i/5).toFixed(2)}</text><text x="${xx}" y="${h-b+27}" text-anchor="middle">${(xmin+(xmax-xmin)*i/5).toFixed(2)}</text>`}
 for(const [i,s]of series.entries()){
  const path=s.points.map((p,j)=>`${j?'L':'M'}${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)}`).join(' ')
  svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.4" ${s.dash?'stroke-dasharray="7 4"':''}/>`
  for(const p of s.points){svg+=`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.6" fill="${s.color}"/>`;if(p[2])svg+=`<path d="M${x(p[0])} ${y(p[1]-p[2])}V${y(p[1]+p[2])}" stroke="${s.color}" opacity=".35"/>`}
  svg+=`<path d="M${l+i*215} 48h20" stroke="${s.color}" stroke-width="3"/><text x="${l+27+i*215}" y="53" font-size="13">${escape(s.name)}</text>`
 }
 svg+=`<path d="M${l} ${t}V${h-b}H${w-r}" fill="none" stroke="#263238"/><text x="${w/2}" y="${h-22}" text-anchor="middle">${escape(xLabel)}</text><text transform="translate(23 ${h/2}) rotate(-90)" text-anchor="middle">${escape(yLabel)}</text></g></svg>`
 writeFileSync(`${root}/${name}.svg`,svg)
}
const A=cases.find(c=>c.name==='A').data
const cache=read('A-fresh/field-cache.json'),status=read('A-fresh/baseline-settings.json'),packed=gunzipSync(Buffer.from(cache.volume.data,'base64')),volume=new Uint16Array(packed.buffer,packed.byteOffset,packed.byteLength/2),n=status.gi.interpolationProfile.dimensions.volumeN,coefficientCount=status.coefficientCount,height=cache.layout.floors.length*14,bounds=cache.layout.bounds,cabinet=read('A-fresh/wall-profile.json').bounds
const taps=A.results.map(p=>{
 const floor=Math.round(p.selection[0]),range=cache.layout.ranges[floor],clamp=v=>Math.max(0,Math.min(1,v)),[px,py,pz]=p.samplePosition,gx=clamp((px-bounds.minX)/bounds.size)*(n-1),gz=clamp((pz-bounds.minZ)/bounds.size)*(n-1),gy=floor*14+1+clamp((py-range.bottom)/(range.top-range.bottom))*11,[nx,ny,nz]=p.shadingNormal,basis=[.886227,1.023328*ny,1.023328*nz,1.023328*nx],coefficients=Array.from({length:4},()=>[0,0,0]),texels=[];let support=0
 for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const ix=Math.min(n-1,Math.floor(gx)+dx),iz=Math.min(n-1,Math.floor(gz)+dz),iy=Math.floor(gy)+dy,weight=(dx?gx%1:1-gx%1)*(dy?gy%1:1-gy%1)*(dz?gz%1:1-gz%1),stored=Array.from({length:coefficientCount},(_,k)=>{const offset=((iz*height*coefficientCount+k*height+iy)*n+ix)*4;return[0,1,2,3].map(c=>DataUtils.fromHalfFloat(volume[offset+c]))}),position=[bounds.minX+ix/(n-1)*bounds.size,range.bottom+(iy-floor*14-1)/11*(range.top-range.bottom),bounds.minZ+iz/(n-1)*bounds.size]
  for(let k=0;k<4;k++)for(let c=0;c<3;c++)coefficients[k][c]+=stored[k][c]*weight;support+=stored[0][3]*weight
  texels.push({coordinate:[ix,iy,iz],position,weight,coverage:stored[0][3],irradiance:[0,1,2].map(c=>Math.max(0,stored.reduce((s,a,k)=>s+a[c]*basis[k],0)/Math.max(.00001,stored[0][3]))),insideCabinetBounds:position.every((v,c)=>v>=cabinet.min[c]&&v<=cabinet.max[c])})
 }
 const manualFiltered=[0,1,2].map(c=>Math.max(0,coefficients.reduce((s,a,k)=>s+a[c]*basis[k],0)/Math.max(.00001,support)))
 return{name:p.name,height:p.position[1],actualShaderSamplePosition:p.samplePosition,measuredGPU:p.shaderIrradiance,manualFiltered,support,texels}
})
writeFileSync(`${root}/volume-taps.json`,JSON.stringify({method:'CPU reconstruction of the eight packed-volume texels at positions independently read from the production GPU receiver. measuredGPU is the float framebuffer result; manualFiltered is a separate diagnostic, not a substitute for it. insideCabinetBounds is an AABB test, not a triangle visibility test.',maxGPUAgreementError:Math.max(...taps.flatMap(p=>p.manualFiltered.map((v,c)=>Math.abs(v-p.measuredGPU[c])))),points:taps},null,2))
plot('wall-stages','Cabinet present: where irradiance diverges',[
 {name:'Independent reference',color:'#171717',points:A.results.map(p=>[p.position[1]-top,mean(reference(p)),mean(p.reference.skyStandardError.map((v,c)=>v+p.reference.reflectedStandardError[c]))])},
 {name:'Before volume filtering',color:'#07845b',points:A.results.map(p=>[p.position[1]-top,mean(p.preFilterAtShaderPosition.rgb)])},
 {name:'Actual GPU shader',color:'#cc4433',points:A.results.map(p=>[p.position[1]-top,mean(p.shaderIrradiance)])}
],'Height above worktop (m)','RGB-mean indirect irradiance')
plot('wall-present-removed','Cabinet present / removed: production GPU and independent reference',cases.filter(c=>['A','C'].includes(c.name)).flatMap((c,i)=>[
 {name:`${i?'Removed':'Present'} GPU`,color:i?'#07845b':'#cc4433',points:c.data.results.map(p=>[p.position[1]-top,mean(p.shaderIrradiance)])},
 {name:`${i?'Removed':'Present'} reference`,color:i?'#165ac5':'#171717',dash:true,points:c.data.results.map(p=>[p.position[1]-top,mean(reference(p))])}
]),'Height above original worktop (m)','RGB-mean indirect irradiance')
if(B&&C)plot('incremental-fresh','Identical cabinet-removed geometry: incremental versus fresh',[
 {name:'Incremental GPU',color:'#cc4433',points:B.results.map(p=>[p.position[1]-top,mean(p.shaderIrradiance)])},
 {name:'Fresh GPU',color:'#165ac5',points:C.results.map(p=>[p.position[1]-top,mean(p.shaderIrradiance)])}
],'Height above original worktop (m)','RGB-mean indirect irradiance')
if(cases.some(c=>c.name==='10cm'))plot('wall-displacement','Cabinet displacement: production GPU profiles',cases.filter(c=>['A','10cm','20cm'].includes(c.name)).map((c,i)=>({name:c.name==='A'?'Original':c.name,color:['#cc4433','#07845b','#165ac5'][i],points:c.data.results.map(p=>[p.position[1]-top,mean(p.shaderIrradiance)])})),'Height above worktop (m)','RGB-mean indirect irradiance')

const sofa=read('sofa-reference/reference.json'),candidate=read('sofa-reference/small-bias-candidate.json')
if(sofa){
 const points=sofa.results.filter(p=>p.camera==='sofa-rear'),metrics={}
 for(const group of ['seat-back-','left-seat-boundary-','armrest-']){
  const rows=points.filter(p=>new RegExp(`^${group}\\d+$`).test(p.name)),trial=rows.map(p=>candidate?.find(q=>q.name===p.name)),x=p=>rows.indexOf(p)
  plot(`sofa-${group.slice(0,-1)}`,`${group.slice(0,-1)}: physical reference and GI sampling`,[
   {name:'Reference',color:'#171717',points:rows.map(p=>[x(p),mean(reference(p))])},
   {name:'Production GPU',color:'#cc4433',points:rows.map(p=>[x(p),mean(p.shaderIrradiance)])},
   {name:'2 mm offset GPU',color:'#07845b',points:rows.map((p,i)=>[x(p),mean(trial[i]?.shaderIrradiance??p.shaderIrradiance)])}
  ],'Surface sample along fixed camera path (index)','RGB-mean indirect irradiance')
  metrics[group]={production:summary(rows.flatMap(p=>p.shaderIrradiance.map((v,c)=>v-reference(p)[c]))),candidate:summary(rows.flatMap((p,i)=>(trial[i]?.shaderIrradiance??p.shaderIrradiance).map((v,c)=>v-reference(p)[c])))}
 }
 const displayed=[]
 for(const camera of ['sofa-rear','kitchen-units']){
  const imageCase=existsSync(`${root}/ao-disabled-captures/${camera}-GI.png`)?'ao-disabled-captures':'sofa-reference',path=`${root}/${imageCase}/${camera}-GI.png`;if(!existsSync(path))continue
  const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  for(const p of sofa.results.filter(p=>p.camera===camera)){const index=(p.y*info.width+p.x)*4;displayed.push({...p,displayedSRGB8:Array.from(data.subarray(index,index+3)),displayedSource:path})}
 }
 writeFileSync(`${root}/sofa-metrics.json`,JSON.stringify(metrics,null,2));writeFileSync(`${root}/displayed-receivers.json`,JSON.stringify(displayed,null,2))
}
const files=['colin_house_v2.json','src/indirectLightingShader.ts','src/indirectVolume.ts','src/indirectFloorLighting.ts','src/indirectLighting.ts']
writeFileSync(`${root}/source-final.json`,JSON.stringify(Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),null,2))
for(const file of readdirSync(root).filter(f=>f.endsWith('.svg')))await sharp(`${root}/${file}`).png().toFile(`${root}/${file.slice(0,-4)}.png`)
console.log(JSON.stringify({wall:budget.map(c=>({case:c.name,nearJunction:c.groups.nearJunction})),incrementalVsFresh:read('incremental-vs-fresh.json')?.gpuIrradiance,sofa:read('sofa-metrics.json')},null,2))
