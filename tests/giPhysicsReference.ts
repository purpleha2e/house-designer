/** Independent transport reference: plain vectors, analytic rectangle/box
 * intersections and cosine-weighted Monte Carlo. No renderer/probe/SH code. */
export type V=[number,number,number]
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const add=(a:V,b:V,s=1):V=>[a[0]+s*b[0],a[1]+s*b[1],a[2]+s*b[2]]
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
export const unit=(v:V):V=>{const l=Math.hypot(...v);return v.map(x=>x/l) as V}
export const srgbLinear=(s:number)=>s<=.04045?s/12.92:((s+.055)/1.055)**2.4

/** Source square [-1,1]^2 at z=0, normal +z, uniform radiance. */
export function squareTransfer(point:V,normal:V,radiance:V,steps=512,blocked=false,kernel:'cosine'|'L1'='cosine'){
 const sum=[0,0,0] as V,da=4/(steps*steps)
 if(blocked)return sum
 for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
  const q:V=[-1+(x+.5)*2/steps,-1+(y+.5)*2/steps,0],d=add(q,point,-1),r2=dot(d,d),r=Math.sqrt(r2),wi=d.map(v=>v/r) as V
  const receiving=kernel==='cosine'?Math.max(0,dot(normal,wi)):.25+.5*dot(normal,wi)
  const factor=receiving*Math.max(0,-wi[2])/r2*da
  for(let c=0;c<3;c++)sum[c]+=radiance[c]*factor
 }
 return sum.map(v=>Math.max(0,v)) as V
}

export type RoomCase={name:string;rho:V;emission:'all'|'ceiling'|'none';window:boolean;sun:number;direction:V}
const planes=[{axis:0,value:0,n:[1,0,0]},{axis:0,value:4,n:[-1,0,0]},
 {axis:1,value:0,n:[0,1,0]},{axis:1,value:3,n:[0,-1,0]},
 {axis:2,value:0,n:[0,0,1]},{axis:2,value:4,n:[0,0,-1]}] as {axis:number;value:number;n:V}[]
export function roomHit(p:V,d:V,opening:boolean){
 let best=Infinity,result:undefined|{p:V;n:V;face:number}
 for(let face=0;face<planes.length;face++){
  const plane=planes[face];if(dot(d,plane.n)>=0)continue
  const t=(plane.value-p[plane.axis])/d[plane.axis];if(t<1e-7||t>=best)continue
  const q=add(p,d,t);if(q[0]<-1e-6||q[0]>4.000001||q[1]<-1e-6||q[1]>3.000001||q[2]<-1e-6||q[2]>4.000001)continue
  best=t;result=opening&&face===4&&q[0]>1&&q[0]<3&&q[1]>.7&&q[1]<2.5?undefined:{p:q,n:plane.n,face}
 }
 return result
}
export function roomReference(point:V,normal:V,config:RoomCase,samples=131072,passes=6,seed=173){
 let state=seed>>>0;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296}
 const cosine=(n:V):V=>{const r=Math.sqrt(rand()),a=2*Math.PI*rand(),t=unit(cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)),b=cross(n,t);return add(add(t.map(v=>v*r*Math.cos(a)) as V,b,r*Math.sin(a)),n,Math.sqrt(1-r*r))}
 const sun=unit(config.direction),emission:V=[1,.5,.25],sky:V=[.65,.72,.82],byBounce=Array.from({length:passes},()=>[0,0,0] as V),squares=Array.from({length:passes},()=>[0,0,0] as V),cumulativeSquares=Array.from({length:passes},()=>[0,0,0] as V)
 for(let s=0;s<samples;s++){
  let p=point,n=normal,throughput:V=[Math.PI,Math.PI,Math.PI];const path=Array.from({length:passes},()=>[0,0,0] as V)
  for(let bounce=0;bounce<passes;bounce++){
   const d=cosine(n),hit=roomHit(add(p,n,1e-6),d,config.window),value:V=[0,0,0]
   if(!hit){
    if(config.window)for(let c=0;c<3;c++)value[c]=throughput[c]*(d[1]>=0?sky[c]*(.6+.8*d[1]):.2*(sky[c]*17/15+config.sun*Math.max(0,sun[1])/Math.PI))
   }else{
    if(config.emission==='all'||config.emission==='ceiling'&&hit.face===3)for(let c=0;c<3;c++)value[c]+=throughput[c]*emission[c]
    if(config.sun&&dot(hit.n,sun)>0&&!roomHit(add(hit.p,hit.n,1e-6),sun,config.window))for(let c=0;c<3;c++)value[c]+=throughput[c]*config.rho[c]/Math.PI*config.sun*dot(hit.n,sun)
   }
   for(let c=0;c<3;c++){byBounce[bounce][c]+=value[c];squares[bounce][c]+=value[c]*value[c];path[bounce][c]=value[c]}
   if(!hit)break
   throughput=throughput.map((v,c)=>v*config.rho[c]) as V;p=hit.p;n=hit.n
  }
  const cumulative:V=[0,0,0]
  for(let k=0;k<passes;k++)for(let c=0;c<3;c++){cumulative[c]+=path[k][c];cumulativeSquares[k][c]+=cumulative[c]**2}
 }
 const increments=byBounce.map(v=>v.map(x=>x/samples) as V),stderr=squares.map((v,k)=>v.map((x,c)=>Math.sqrt(Math.max(0,x/samples-increments[k][c]**2)/samples)) as V),cumulative=increments.map((_,k)=>[0,1,2].map(c=>increments.slice(0,k+1).reduce((sum,v)=>sum+v[c],0)) as V)
 const cumulativeStderr=cumulativeSquares.map((v,k)=>v.map((x,c)=>Math.sqrt(Math.max(0,x/samples-cumulative[k][c]**2)/samples)) as V)
 return{samples,passes,increments,stderr,cumulative,cumulativeStderr}
}
