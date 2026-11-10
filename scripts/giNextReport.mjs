import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs'
import {gunzipSync,gzipSync} from 'node:zlib'
import sharp from 'sharp'
import {DataUtils,Vector3} from 'three'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
const root='docs/gi-next',experiment=`${root}/experiments`,read=p=>JSON.parse(readFileSync(`${root}/${p}.json`)),mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length)
const surface=read('experiments/surface'),reference=read('experiments/surface-reference'),baseline=read('baseline/reference'),acceleration=read('experiments/acceleration')
const indirect=r=>r.sky.map((v,c)=>v+r.reflected[c]),error=(points,method)=>{const deltas=points.flatMap(p=>p[method].map((v,c)=>v-p.reference[c]));return{points:points.length,mae:mean(deltas.map(Math.abs)),rmse:Math.sqrt(mean(deltas.map(v=>v*v))),maximumAbsoluteError:Math.max(...deltas.map(Math.abs)),signedMean:mean(deltas)}}
const known=surface.points.map(p=>{const r=baseline.results.find(r=>r.name===p.name);if(!r)throw Error('Missing reference '+p.name);return{...p,direct:p.direct.rgb,unoccluded:p.unoccluded.rgb,reference:indirect(r.reference),referenceSE:r.reference.skyStandardError.map((v,c)=>v+r.reference.reflectedStandardError[c])}})
const coverage=surface.coverage.map((p,i)=>({...p,direct:p.direct.rgb,unoccluded:p.unoccluded.rgb,reference:indirect(reference.results[i].reference),localPaths:indirect(reference.results[i].localPaths)}))
const methods=['volume','unoccluded','direct','vertex','lightmap'],metrics={known:Object.fromEntries(methods.map(m=>[m,error(known,m)])),allFaceCentres:Object.fromEntries([...methods,'localPaths'].map(m=>[m,error(coverage,m)])),scope:'Unweighted RGB component errors against indirect (sky + reflected) reference. Known points: 8192 paths, actual production raster volume. All 3020 triangle centres: 256 paths, CPU volume sampling with interpolated vertex normals and face bias, no normal-map sampling. 64-path local evaluation shares the reference implementation with independent seeds; it is a cost/variance diagnostic, not a separately validated renderer.'}
const wall=read('baseline/wall-profile'),wallPoints=wall.points.map(p=>({...p,volume:p.shaderIrradiance,reference:indirect(baseline.results.find(r=>r.name===p.name).reference)}))
metrics.kitchenBaseline=error(wallPoints,'volume')
writeFileSync(`${root}/kitchen-profile.csv`,['height_above_worktop,volume_mean,reference_mean',...wallPoints.map(p=>[p.position[1]-wall.top,mean(p.volume),mean(p.reference)].join(','))].join('\n'))
if(existsSync(`${experiment}/depth.json`)){
  const depth=read('experiments/depth'),cache=read('baseline/field-cache'),coefficients=read('experiments/provenance').settings.coefficients,radius=cache.layout.spacing*1.75,count=cache.layout.shOrder===2?9:4
  metrics.depthKnown={}
  for(const row of depth){
    const values=surface.points.map((p,i)=>{
      const basis=indirectSHIrradianceBasis(new Vector3().fromArray(p.normal),cache.layout.shOrder),evaluate=key=>{let total=0;const rgb=[0,0,0];for(const link of p.direct.links){const test=row.classifications.find(t=>t.name===p.name&&t.index===link.index);if(!test)throw Error('Missing depth classification');if(!test[key])continue;const d2=link.distance**2,weight=(1-d2/radius**2)**2/(d2+.15**2);total+=weight;for(let c=0;c<3;c++)for(let k=0;k<count;k++)rgb[c]+=weight*basis[k]*DataUtils.fromHalfFloat(coefficients[c][link.index*count+k])}return rgb.map(v=>Math.max(0,v/(total||1)))}
      const check=evaluate('expected');if(check.some((v,c)=>Math.abs(v-p.direct.rgb[c])>1e-6))throw Error('Offline depth reconstruction disagrees with original BVH control')
      return{name:p.name,reference:known[i].reference,depth:evaluate('actual')}
    })
    metrics.depthKnown[row.size]={...error(values,'depth'),values}
  }
}
writeFileSync(`${root}/metrics.json`,JSON.stringify(metrics,null,2))
writeFileSync(`${root}/receivers.json`,JSON.stringify(known,null,2))
const csv=['name,face,method,r,g,b,reference_r,reference_g,reference_b',...known.flatMap(p=>methods.map(m=>[JSON.stringify(p.name),p.face,m,...p[m],...p.reference].join(',')))].join('\n')
writeFileSync(`${root}/seam-profiles.csv`,csv)
console.log(JSON.stringify({metrics,face1049:known.filter(p=>p.face===1049).map(p=>({name:p.name,reference:p.reference,volume:p.volume,vertex:p.vertex,lightmap:p.lightmap})),acceleration:{cold:acceleration.blasAndInstancesMs+acceleration.tlasBuildMs,flat:acceleration.flatBuildMs}},null,2))
const cameras=read('baseline/cameras')
for(const [source,folder]of [[experiment,'comparisons'],[`${root}/white`,'white-comparisons']]){
const comparisonDir=`${root}/${folder}`;mkdirSync(comparisonDir,{recursive:true})
for(const camera of cameras){
  if(!existsSync(`${source}/${camera.id}-lightmap.png`))continue
  const files=['production','vertex','lightmap'].map(mode=>`${source}/${camera.id}-${mode}.png`),meta=await sharp(files[0]).metadata()
  await sharp({create:{width:meta.width*3,height:meta.height,channels:3,background:'white'}}).composite(files.map((input,i)=>({input,left:i*meta.width,top:0}))).png().toFile(`${comparisonDir}/${camera.id}-side-by-side.png`)
  const decode=mode=>{const raw=gunzipSync(readFileSync(`${source}/${camera.id}-${mode}.rgba16f.gz`));return new Uint16Array(raw.buffer,raw.byteOffset,raw.byteLength/2)}
  const production=decode('production')
  const hdrWidth=production.length/4/meta.height
  if(!Number.isInteger(hdrWidth))throw Error('HDR dimensions do not match screenshot height')
  for(const mode of ['vertex','lightmap']){
    const current=decode(mode),diff=new Float32Array(production.length),absHDR=new Float32Array(production.length),absolute=Buffer.alloc(hdrWidth*meta.height*3),signed=Buffer.alloc(absolute.length)
    for(let y=0;y<meta.height;y++)for(let x=0;x<hdrWidth;x++)for(let c=0;c<3;c++){
      const i=((meta.height-1-y)*hdrWidth+x)*4+c,v=DataUtils.fromHalfFloat(current[i])-DataUtils.fromHalfFloat(production[i]);if(!Number.isFinite(v))throw Error('Nonfinite HDR difference');diff[i]=v;absHDR[i]=Math.abs(v);const out=(y*hdrWidth+x)*3+c;absolute[out]=Math.round(Math.min(1,Math.abs(v))*255);signed[out]=Math.round(Math.max(0,Math.min(1,.5+.5*v))*255)
    }
    writeFileSync(`${comparisonDir}/${camera.id}-${mode}-signed-hdr.f32.gz`,gzipSync(Buffer.from(diff.buffer)))
    writeFileSync(`${comparisonDir}/${camera.id}-${mode}-absolute-hdr.f32.gz`,gzipSync(Buffer.from(absHDR.buffer)))
    await sharp(absolute,{raw:{width:hdrWidth,height:meta.height,channels:3}}).png().toFile(`${comparisonDir}/${camera.id}-${mode}-absolute.png`)
    await sharp(signed,{raw:{width:hdrWidth,height:meta.height,channels:3}}).png().toFile(`${comparisonDir}/${camera.id}-${mode}-signed.png`)
    writeFileSync(`${comparisonDir}/${camera.id}-${mode}-metadata.json`,JSON.stringify({width:hdrWidth,height:meta.height,format:'RGBA Float32 little-endian, bottom-up; alpha 0; gzip',signed:'candidate - production',png:'absolute=min(abs(delta),1); signed=clamp(.5+.5*delta,0,1); display diagnostics only, not tone-mapped scene radiance'}))
  }
}
}
