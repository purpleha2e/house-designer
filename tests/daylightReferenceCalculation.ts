/** Independent diffuse path tracer for the rectangular reference room. No
 * renderer, voxel, SH, capture or interpolation implementation is reused. */
type V = [number,number,number]
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const unit=(a:V):V=>{const s=Math.hypot(...a);return a.map(v=>v/s) as V}
const plus=(a:V,b:V,s=1):V=>a.map((v,i)=>v+b[i]*s) as V
const planes=[{axis:0,value:0,n:[1,0,0]},{axis:0,value:5,n:[-1,0,0]},
  {axis:1,value:0,n:[0,1,0]},{axis:1,value:2.8,n:[0,-1,0]},
  {axis:2,value:0,n:[0,0,1]},{axis:2,value:4,n:[0,0,-1]}] as {axis:number;value:number;n:V}[]
function intersect(p:V,d:V,sealed:boolean){
  let nearest=Infinity,hit:undefined|{p:V;n:V;rho:number}
  for(const plane of planes){const t=(plane.value-p[plane.axis])/d[plane.axis];if(t<.00001||t>=nearest||dot(d,plane.n)>=0)continue
    const q=plus(p,d,t);if(q[0]<-.00001||q[0]>5.00001||q[1]<-.00001||q[1]>2.80001||q[2]<-.00001||q[2]>4.00001)continue
    nearest=t
    hit=!sealed&&plane.axis===2&&plane.value===0&&q[0]>1&&q[0]<4&&q[1]>.8&&q[1]<2.5?undefined:{p:q,n:plane.n,rho:plane.axis===1&&plane.value===0?.35:.8}
  }
  return hit
}
export function referenceIrradiance(point:V,normal:V,{samples=32768,depth=6,sealed=false,sky='legacy',sun='none',seed=1234}:
  {samples?:number;depth?:number;sealed?:boolean;sky?:'legacy'|'overcast'|'clear';sun?:'none'|'away'|'direct';seed?:number}={}) {
  let randomState=seed>>>0
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return (randomState+.5)/4294967296}
  const sunlight=unit([0,6,sun==='direct'?-8:6])
  const skyValue=(d:V):V=>{
    if(sky==='legacy')return [.65,.72,.82]
    if(d[1]<0){const f=sky==='overcast'?7/6:17/15,g=sun==='none'?0:3*sunlight[1]/Math.PI;return [.65,.72,.82].map(c=>(c*f+g)*.2) as V}
    // Same specified analytic sky, independently evaluated (no shared GLSL/CPU code).
    const f=sky==='overcast'?.5+d[1]:.6+.8*d[1]
    return [.65*f,.72*f,.82*f]
  }
  const cosine=(n:V):V=>{const u=random(),v=random(),r=Math.sqrt(u),a=2*Math.PI*v,t=unit(cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)),b=cross(n,t);return plus(plus(t.map(c=>c*r*Math.cos(a)) as V,b,r*Math.sin(a)),n,Math.sqrt(1-u))}
  const result=[0,0,0] as V
  for(let sample=0;sample<samples;sample++){
    let p=point,n=normal,throughput=Math.PI
    for(let bounce=0;bounce<=depth;bounce++){
      // Direct sunlight at the receiver is displayed separately, so begin NEE
      // on the first reflected surface, matching the indirect GPU field.
      const d=cosine(n),hit=intersect(plus(p,n,.00002),d,sealed)
      if(!hit){const value=skyValue(d);for(let c=0;c<3;c++)result[c]+=throughput*value[c];break}
      if(sun!=='none'&&!intersect(plus(hit.p,hit.n,.00002),sunlight,sealed)){
        const outgoing=hit.rho/Math.PI*3*Math.max(0,dot(hit.n,sunlight));for(let c=0;c<3;c++)result[c]+=throughput*outgoing
      }
      throughput*=hit.rho;p=hit.p;n=hit.n
    }
  }
  return result.map(c=>c/samples) as V
}

/** Test-only incident radiance for isolating angular representation error at a
 * fixed point. Uses the independent room geometry and diffuse path sampling;
 * no production SH, probes, interpolation or renderer functions are involved. */
export function referenceIncidentRadiance(point:V,initialDirection:V,{depth=6,seed=1234}:{depth?:number;seed?:number}={}) {
  let state=seed>>>0
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296}
  const cosine=(n:V):V=>{const u=random(),v=random(),r=Math.sqrt(u),a=2*Math.PI*v,t=unit(cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)),b=cross(n,t);return plus(plus(t.map(c=>c*r*Math.cos(a)) as V,b,r*Math.sin(a)),n,Math.sqrt(1-u))}
  const sunlight=unit([0,6,6]),result=[0,0,0] as V
  let p=point,d=initialDirection,throughput=1
  for(let bounce=0;bounce<=depth;bounce++){
    const hit=intersect(p,d,false)
    if(!hit){
      for(let c=0;c<3;c++){const base=[.65,.72,.82][c];result[c]+=throughput*(d[1]>=0?base*(.6+.8*d[1]):.2*(base*17/15+3*sunlight[1]/Math.PI))}
      break
    }
    p=plus(hit.p,hit.n,.00002)
    if(!intersect(p,sunlight,false)){const value=throughput*hit.rho/Math.PI*3*Math.max(0,dot(hit.n,sunlight));for(let c=0;c<3;c++)result[c]+=value}
    throughput*=hit.rho;d=cosine(hit.n)
  }
  return result
}
