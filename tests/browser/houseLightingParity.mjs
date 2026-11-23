// Feed the original two-room geometry through the imported-house renderer.
// Compare linear bounced light at matching wall/ceiling patches, before exposure.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
const out='tmp/lighting-lab/parity';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={}
const prototypeMeasure=`Promise.all(['Left side wall','Left ceiling','Right side wall','Right ceiling'].map(name=>lightingLab.measureCard(name,'filtered',{x:8,y:8,width:16,height:16})))`
try {
  await b.call('Page.navigate',{url:'http://127.0.0.1:5188/lighting-lab/'})
  await b.wait('window.lightingLab?.stats().frames>120')
  await b.evaluate(`(()=>{const lab=lightingLab;lab.geometry.cards.forEach(c=>{if(c.kind===1)c.kind=0});lab.uploadCards();lab.setLamp(0,false);lab.setLamp(1,false)})()`)
  const start=await b.evaluate('lightingLab.stats().frames');await b.wait(`lightingLab.stats().frames>${start+600}`)
  report.prototype=await b.evaluate(prototypeMeasure)
  await b.evaluate('lightingLab.setDaylight(false);lightingLab.setLamp(0,true);lightingLab.setLamp(1,true)')
  const lampStart=await b.evaluate('lightingLab.stats().frames');await b.wait(`lightingLab.stats().frames>${lampStart+600}`)
  report.prototypeLamps=await b.evaluate(prototypeMeasure)
  await b.evaluate(`(async()=>{
    const {HouseLightingLab}=await import('/src/lightingLab/houseEngine.ts');
    const {prepareHouseGeometry}=await import('/src/lightingLab/houseGeometry.ts');
    const {Matrix4}=await import('/node_modules/three/build/three.module.js');
    const old=lightingLab,parts=[],finishes=[];
    for(const c of old.geometry.cards){
      if(c.kind===3)continue;
      const position=[];for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]])position.push(...c.centre.clone().addScaledVector(c.u,x).addScaledVector(c.v,y).toArray());
      parts.push({name:c.name,position:new Float32Array(position),ranges:[{start:0,count:6,material:finishes.length}],matrices:[new Matrix4().toArray()],structural:true});
      finishes.push({colour:c.colour.toArray(),emission:[0,0,0],map:null,alphaTest:0,side:0});
    }
    const snapshot={parts,finishes,position:old.camera.position.toArray(),quaternion:old.camera.quaternion.toArray(),fov:65};old.dispose();
    const lab=new HouseLightingLab(document.querySelector('#viewport'),snapshot,prepareHouseGeometry(parts,()=>{}));window.parityLab=lab;
    lab.setInput({lights:[],sunDirection:[0,1,0],sunColour:[0,0,0],daylight:true});await lab.start(()=>{},()=>{},()=>{});
  })()`)
  await b.wait('parityLab.stats().frames>600')
  const houseMeasure=`(async()=>{
    const {DataUtils}=await import('/node_modules/three/build/three.module.js');const lab=parityLab,data=lab.data,results=[];
    for(const name of ['Left side wall','Left ceiling','Right side wall','Right ceiling']){
      const id=data.cards.findIndex(c=>c.name===name),pixels=new Uint16Array(16*16*4),origin=[id%32*16,Math.floor(id/32)*16];
      await lab.renderer.readRenderTargetPixelsAsync(lab.filtered,...origin,16,16,pixels);
      const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
      for(let v=0;v<data.chart.length;v+=2)if(Math.floor(data.chart[v]/16)+Math.floor(data.chart[v+1]/16)*32===id){
        for(let axis=0;axis<2;axis++){const q=data.chart[v+axis]-origin[axis];lo[axis]=Math.min(lo[axis],q);hi[axis]=Math.max(hi[axis],q);}
      }
      // Match the prototype's physical patch, accounting for the house chart's
      // padding. Reading its central 8 texels sampled a larger piece of wall.
      const rgb=[0,0,0];
      for(let y=8;y<24;y++)for(let x=8;x<24;x++){
        const q=[x,y].map((p,axis)=>lo[axis]+(p+.5)/32*(hi[axis]-lo[axis])-.5),b=q.map(Math.floor),f=q.map((p,i)=>p-b[i]);
        const value=[0,0,0,0];
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
          const at=((b[1]+dy)*16+b[0]+dx)*4,weight=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1]);
          for(let ch=0;ch<4;ch++)value[ch]+=DataUtils.fromHalfFloat(pixels[at+ch])*weight;
        }
        for(let ch=0;ch<3;ch++)rgb[ch]+=value[ch]/Math.max(value[3],.001)/256;
      }
      results.push({name,rgb});
    }return results;
  })()`
  report.house=await b.evaluate(houseMeasure)
  await b.evaluate(`parityLab.setInput({daylight:false,sunDirection:[0,1,0],sunColour:[0,0,0],lights:[-2,2].map((x,i)=>({id:String(i),kind:'point',position:[x,2.65,0],target:[x,0,0],color:'#fff5e3',power:90,distance:0,falloff:2,angle:1,penumbra:0}))})`)
  // The prototype lamp tint is already linear (1,.91,.77); match it exactly.
  await b.evaluate(`parityLab.uniforms.lightColours.value.slice(0,2).forEach(v=>v.set(1,.91,.77).multiplyScalar(90/(4*Math.PI)))`)
  const houseLampStart=await b.evaluate('parityLab.stats().frames');await b.wait(`parityLab.stats().frames>${houseLampStart+600}`)
  report.houseLamps=await b.evaluate(houseMeasure)
  report.ratios=report.house.map((surface,i)=>surface.rgb.map((v,ch)=>v/report.prototype[i].rgb[ch]))
  report.lampRatios=report.houseLamps.map((surface,i)=>surface.rgb.map((v,ch)=>v/report.prototypeLamps[i].rgb[ch]))
  report.stats=await b.evaluate('parityLab.stats()')
  writeFileSync(out+'/report.json',JSON.stringify(report,null,2))
  for(const ratios of [...report.ratios,...report.lampRatios])for(const ratio of ratios)assert.ok(ratio>.85&&ratio<1.15,`Matched scene transport differs: ${ratio}`)
  assert.deepEqual(b.errors,[])
  console.log(JSON.stringify(report))
} finally { b.close() }
