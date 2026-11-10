import fs from 'node:fs'
import assert from 'node:assert/strict'
import {SphericalHarmonics3,Vector3} from 'three'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis,evaluateIndirectSHOrder} from '../src/indirectSH.ts'
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)}
const sphere=n=>Array.from({length:n},(_,i)=>{const y=1-2*(i+.5)/n,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y);return[r*Math.cos(a),y,r*Math.sin(a)]})
const directions=sphere(16384),normals=sphere(2048),axis=unit([.3,.7,-.4])
// Rodrigues rotation, independent from renderer SH code.
const rotate=(v,angle)=>{const k=unit([1,2,3]),c=Math.cos(angle),s=Math.sin(angle),d=dot(k,v);return v.map((x,i)=>x*c+[k[1]*v[2]-k[2]*v[1],k[2]*v[0]-k[0]*v[2],k[0]*v[1]-k[1]*v[0]][i]*s+k[i]*d*(1-c))}
const environment=fn=>directions.map(d=>({d,rgb:fn(d).map(v=>v*4*Math.PI/directions.length)}))
const cases=[
 {name:'constant',samples:environment(()=>[1,.5,.25])},
 {name:'directional',samples:[{d:axis,rgb:[1,.5,.25]}]},
 {name:'symmetric opposite sources',samples:[{d:axis,rgb:[1,.5,.25]},{d:axis.map(v=>-v),rgb:[1,.5,.25]}]},
 {name:'hemisphere',samples:environment(d=>d[1]>=0?[1,.5,.25]:[0,0,0])},
 {name:'smooth lobe',samples:environment(d=>[1,.5,.25].map(c=>c*Math.exp(12*(dot(d,axis)-1))))},
 {name:'rotated smooth lobe',samples:environment(d=>[1,.5,.25].map(c=>c*Math.exp(12*(dot(d,rotate(axis,.87))-1))))},
 {name:'independent RGB sources',samples:[{d:[1,0,0],rgb:[1,0,0]},{d:[0,1,0],rgb:[0,.5,0]},{d:[0,0,1],rgb:[0,0,.25]}]},
]
const results=[]
for(const fixture of cases){
 const projected=new SphericalHarmonics3()
 for(const sample of fixture.samples){const basis=indirectSHRadianceBasis(new Vector3(...sample.d),2);for(let k=0;k<9;k++)for(let c=0;c<3;c++)projected.coefficients[k].setComponent(c,projected.coefficients[k].getComponent(c)+sample.rgb[c]*basis[k])}
 const reference=normals.map(n=>{const sum=[0,0,0];for(const s of fixture.samples){const cosine=Math.max(0,dot(n,s.d));for(let c=0;c<3;c++)sum[c]+=s.rgb[c]*cosine}return sum})
 const orders=[]
 for(const order of [1,2]){
  const channels=Array.from({length:3},()=>({squareError:0,maxError:0,minUnclamped:Infinity,negativeCount:0,referenceIntegral:0,unclampedIntegral:0,clampedIntegral:0,maxDarkLeakage:0}))
  for(let i=0;i<normals.length;i++){
   const n=new Vector3(...normals[i]),basis=indirectSHIrradianceBasis(n,order),clamped=evaluateIndirectSHOrder(projected,n,order)
   for(let c=0;c<3;c++){
    const raw=basis.reduce((sum,b,k)=>sum+b*projected.coefficients[k].getComponent(c),0),actual=clamped.getComponent(c),expected=reference[i][c],m=channels[c],error=actual-expected
    assert.ok(actual>=0);assert.ok(Math.abs(actual-Math.max(0,raw))<1e-12)
    m.squareError+=error*error;m.maxError=Math.max(m.maxError,Math.abs(error));m.minUnclamped=Math.min(m.minUnclamped,raw);m.negativeCount+=raw<0?1:0
    m.referenceIntegral+=expected*4*Math.PI/normals.length;m.unclampedIntegral+=raw*4*Math.PI/normals.length;m.clampedIntegral+=actual*4*Math.PI/normals.length
    if(expected<1e-8)m.maxDarkLeakage=Math.max(m.maxDarkLeakage,actual)
   }
  }
  orders.push({order,channels:channels.map(({squareError,...m})=>({...m,rmse:Math.sqrt(squareError/normals.length),negativeFraction:m.negativeCount/normals.length,clampAddedIntegral:m.clampedIntegral-m.unclampedIntegral,relativeIntegralError:m.clampedIntegral/m.referenceIntegral-1}))})
 }
 if(fixture.name==='constant')for(const o of orders)for(let c=0;c<3;c++)assert.ok(o.channels[c].maxError<.0001)
 if(fixture.name==='hemisphere')for(let i=0;i<normals.length;i++)assert.ok(Math.abs(reference[i][0]-Math.PI*(1+normals[i][1])/2)<.001)
 if(['directional','symmetric opposite sources','smooth lobe','rotated smooth lobe','independent RGB sources'].includes(fixture.name))assert.ok(orders[1].channels[0].rmse<orders[0].channels[0].rmse*.6)
 results.push({name:fixture.name,coefficients:projected.coefficients.map(v=>v.toArray()),orders})
}
// Rotation covariance of the same lobe at paired receiver normals.
let rotationMaxError=0
const base=results.find(r=>r.name==='smooth lobe'),turned=results.find(r=>r.name==='rotated smooth lobe')
for(const order of [1,2])for(const n of normals){const a=indirectSHIrradianceBasis(new Vector3(...n),order),b=indirectSHIrradianceBasis(new Vector3(...rotate(n,.87)),order);for(let c=0;c<3;c++)rotationMaxError=Math.max(rotationMaxError,Math.abs(a.reduce((s,v,k)=>s+v*base.coefficients[k][c],0)-b.reduce((s,v,k)=>s+v*turned.coefficients[k][c],0)))}
assert.ok(rotationMaxError<.0001)
fs.mkdirSync('docs/gi-l2-physics',{recursive:true});fs.writeFileSync('docs/gi-l2-physics/math.json',JSON.stringify({radianceQuadrature:directions.length,receiverNormals:normals.length,rotationMaxError,results},null,2))
console.log(JSON.stringify({rotationMaxError,results:results.map(r=>({name:r.name,L1:r.orders[0].channels[0],L2:r.orders[1].channels[0]}))},null,2))
