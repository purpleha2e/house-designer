import {DataTexture,HalfFloatType,NearestFilter,RGBAFormat,Mesh,PlaneGeometry,ShaderMaterial,Scene,OrthographicCamera,DataUtils,Data3DTexture} from 'three'
import {restoreIndirectField,serializeIndirectField,writeIndirectProbe} from '../../src/indirectLighting'
import {createIndirectVisibility,snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {createIndirectVolumeLookup,writeIndirectVolumeRow} from '../../src/indirectVolume'
import {createIndirectFloorLookup,writeIndirectFloorRow} from '../../src/indirectFloorLighting'
import {updateIndirectUniforms} from '../../src/indirectLightingShader'
import {measureSunlitMaterials} from './sunlitBounceReceivers'

/** Private Jacobi fields, immutable captured geometry, solar-only source subtraction. */
export async function sunlitReplay(s:any,source:any,points:any[],cases:readonly(readonly[string,number])[]=[['A',0],['B',1],['C',2],['no-surface-sun',3]]){
 const {cache,cacheData:d,u}=source,field=restoreIndirectField(serializeIndirectField(source.field)),visibility=createIndirectVisibility(s.scene),volume=createIndirectVolumeLookup(field,visibility),floor=createIndirectFloorLookup(field,visibility),scratch=new Float64Array(12),indices=field.probes.map(p=>p.index),gl=s.gl,old=Object.fromEntries(Object.entries(u).map(([k,v]:any)=>[k,v.value])),tick=()=>new Promise(requestAnimationFrame)
 const tex=(data:Uint16Array)=>{const t=new DataTexture(data,d.width,d.height,RGBAFormat,HalfFloatType);t.minFilter=t.magFilter=NearestFilter;t.needsUpdate=true;return t},textures=[tex(d.baseline),tex(d.solar),tex(d.mask)],scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2),material=new ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{base:{value:textures[0]},solar:{value:textures[1]},mask:{value:textures[2]},mode:{value:0}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 uv0;uniform sampler2D base,solar,mask;uniform float mode;void main(){vec4 b=texture2D(base,uv0);vec2 m=texture2D(mask,uv0).rg;float a=mode<.5?0.:mode<1.5?m.r:mode<2.5?m.g:1.;gl_FragColor=vec4(max(b.rgb-a*texture2D(solar,uv0).rgb,vec3(0.)),b.a);}'})
 scene.add(new Mesh(geometry,material));const setSource=(mode:number)=>{const target=gl.getRenderTarget(),auto=gl.autoClear;material.uniforms.mode.value=mode;cache.currentRadiance.viewport.set(0,0,d.width,d.height);cache.currentRadiance.scissorTest=false;gl.setRenderTarget(cache.currentRadiance);gl.autoClear=true;gl.render(scene,camera);gl.setRenderTarget(target);gl.autoClear=auto}
 const variants:any={},report:any={variants:[],lookupWarmMs:0},started=performance.now(),worker=new Worker(new URL('../../src/indirectFloorFilter.worker.ts',import.meta.url),{type:'module'});let workerId=0
 const filter=(geometry?:any)=>new Promise<any>((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({id:++workerId,radius:.1,field:{shOrder:1,bounds:field.bounds,floors:field.floors.map(f=>({elevation:f.elevation})),floorLayer:{n:field.floorLayer.n,data:field.floorLayer.data}},...(geometry?{geometry}:{})})})
 const bind=(name:string,filtered=true)=>{const v=variants[name];for(let c=0;c<3;c++){field.coefficients[c].set(v.coefficients[c]);field.maps[c].needsUpdate=true}field.volume.data.set(v.volume);field.volume.maps.forEach(t=>t.needsUpdate=true);field.floorLayer.data.set(v.floor);field.floorLayer.texture.needsUpdate=true;field.floorLayer.ready=true;updateIndirectUniforms(u,field);u.hdGIUseVolume.value=1;if(filtered)u.hdGIFloorLayer.value=v.filteredTexture}
 try{
  for(let row=0;row<field.volume.rows;row++){writeIndirectVolumeRow(field,row,scratch,visibility,volume,true);if(row%8===0)await tick()}
  for(let row=0;row<field.floorLayer.n*field.floors.length;row++){writeIndirectFloorRow(field,row,visibility,floor,true);if(row%16===0)await tick()}
  report.lookupWarmMs=performance.now()-started
  for(const [name,mode]of cases){
   const begin=performance.now(),passes=[];setSource(mode);field.coefficients.forEach(a=>a.fill(0));field.volume.data.fill(0);field.floorLayer.data.fill(0);field.volume.maps.forEach(t=>t.needsUpdate=true);field.floorLayer.texture.needsUpdate=true;field.floorLayer.ready=true;updateIndirectUniforms(u,field);u.hdGIUseVolume.value=1
   for(let pass=1;pass<=6;pass++){
    s.scene.userData.sunlitReplayProgress={name,pass};const t=performance.now(),values=await cache.readBatch(indices,()=>false);for(const [index,sh]of values)writeIndirectProbe(field,index,sh)
    volume.refreshCoefficients();floor.refreshCoefficients();for(let row=0;row<field.volume.rows;row++){writeIndirectVolumeRow(field,row,scratch,visibility,volume);if(row%32===0)await tick()}
    for(let row=0;row<field.floorLayer.n*field.floors.length;row++){writeIndirectFloorRow(field,row,visibility,floor);if(row%64===0)await tick()}
    field.volume.maps.forEach(t=>t.needsUpdate=true);field.floorLayer.texture.needsUpdate=true;updateIndirectUniforms(u,field);u.hdGIUseVolume.value=1
    passes.push({pass,ms:performance.now()-t,receivers:await measureSunlitMaterials(s,points),coefficients:field.probes.map(p=>({index:p.index,rgb:field.coefficients.map(a=>Array.from(a.subarray(p.index*4,p.index*4+4),DataUtils.fromHalfFloat))}))})
   }
   const f=await filter(mode===0?snapshotIndirectGeometry(s.scene):undefined),t=new Data3DTexture(f.output,field.floorLayer.n,field.floorLayer.height*4,field.floorLayer.n);Object.assign(t,{type:field.floorLayer.texture.type,format:field.floorLayer.texture.format,colorSpace:field.floorLayer.texture.colorSpace,minFilter:field.floorLayer.texture.minFilter,magFilter:field.floorLayer.texture.magFilter,unpackAlignment:1});t.needsUpdate=true
   variants[name]={coefficients:field.coefficients.map(a=>a.slice()),volume:field.volume.data.slice(),floor:field.floorLayer.data.slice(),filteredTexture:t};bind(name)
   const measurements=await measureSunlitMaterials(s,points);report.variants.push({name,ms:performance.now()-begin,passes,receivers:measurements,filter:f.statistics});await source.save('field-'+name+'.bin.gz',{...variants[name],filteredTexture:undefined,filteredFloor:f.output});source.check()
  }
  return{report,variants,field,bind,restore(){Object.entries(old).forEach(([k,v])=>u[k].value=v);source.check()},dispose(){this.restore();Object.values(variants).forEach((v:any)=>v.filteredTexture.dispose());field.dispose()}}
 }finally{setSource(0);Object.entries(old).forEach(([k,v])=>u[k].value=v);worker.terminate();visibility.dispose();textures.forEach(t=>t.dispose());geometry.dispose();material.dispose();source.check()}
}
