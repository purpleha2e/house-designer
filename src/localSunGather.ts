import {Vector3} from 'three'
import type {IndirectVisibility} from './indirectVisibility.ts'

export type GatherIdentity={geometry:number;lighting:number;source:string;bounces:number}
export type GatherRadiance={valid:boolean;rgb:readonly number[];primitive?:number;side?:number;identity:GatherIdentity;reason?:string}
export type GatherResult={state:'disabled'|'cancelled'|'ready'|'incomplete';rays:number;irradiance:number[]|null;hits?:number;known?:number;confidence?:number;reasons?:Record<string,number>;standardError?:number[]|null;traceMs?:number;lookupMs?:number;totalMs?:number;identity?:GatherIdentity}
type Hit=NonNullable<ReturnType<IndirectVisibility['hit']>>
export const localFinalGatherEnabled=(args:readonly string[])=>args.includes('--local-final-gather')

function radicalInverse(index:number,base:number){let result=0,scale=1/base;while(index){result+=(index%base)*scale;index=Math.floor(index/base);scale/=base}return result}

/** Nested deterministic cosine-weighted samples. The estimator is PI/N sum(L).
 * No BVH, materials, renderer, receiver cache or production shader is created.
 * The caller must supply the GI worker's existing nearest-hit query. */
export function gatherLocalIndirect({enabled,receiver,rays,seed=0,identity,visibility,lookup,cancelled=()=>false,observe}:{
  enabled:boolean;receiver:{position:readonly number[];normal:readonly number[];geometricNormal:readonly number[]};rays:number;seed?:number;identity:GatherIdentity;
  visibility:Pick<IndirectVisibility,'hit'>;lookup:(hit:Hit,direction:Vector3)=>GatherRadiance;cancelled?:()=>boolean;
  observe?:(sample:number,rgb:readonly number[]|null,hit:Hit|null,direction:Vector3)=>void;
}):GatherResult{
  if(!enabled)return {state:'disabled' as const,rays:0,irradiance:null}
  if(!Number.isInteger(rays)||rays<1||rays>4096)throw Error('Invalid gather ray count')
  const normal=new Vector3().fromArray(receiver.normal),geometric=new Vector3().fromArray(receiver.geometricNormal)
  if(!normal.toArray().every(Number.isFinite)||!geometric.toArray().every(Number.isFinite)||normal.lengthSq()<1e-12||geometric.lengthSq()<1e-12)throw Error('Invalid receiver normal')
  normal.normalize();geometric.normalize()
  const origin=new Vector3().fromArray(receiver.position).addScaledVector(geometric,.0002),direction=new Vector3(),axis=Math.abs(normal.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0)
  const tangent=new Vector3().crossVectors(axis,normal).normalize(),bitangent=new Vector3().crossVectors(normal,tangent)
  const sum=[0,0,0],square=[0,0,0],reasons:Record<string,number>={}
  let traced=0,hits=0,known=0,traceMs=0,lookupMs=0
  const started=performance.now(),shift1=((seed>>>0)*.6180339887498949)%1,shift2=((seed>>>0)*.4142135623730951)%1
  for(let i=0;i<rays;i++){
    if(cancelled())return {state:'cancelled' as const,rays:traced,irradiance:null}
    const u=(radicalInverse(i+1,2)+shift1)%1,v=(radicalInverse(i+1,3)+shift2)%1,r=Math.sqrt(u),theta=2*Math.PI*v
    direction.copy(normal).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,r*Math.cos(theta)).addScaledVector(bitangent,r*Math.sin(theta))
    let at=performance.now();const hit=visibility.hit(origin,direction,80,.0001);traceMs+=performance.now()-at;traced++
    // This prototype's source is reflected surface sunlight. An escaped ray has
    // zero surface contribution; sky and solar-ground environment stay separate.
    if(!hit){known++;observe?.(i,[0,0,0],null,direction);continue}
    hits++;at=performance.now();const sample=lookup(hit,direction);lookupMs+=performance.now()-at
    const side=hit.face!.normal.dot(direction)<0?1:-1
    const reason=!sample.valid?sample.reason??'cache-miss':
      sample.primitive!==hit.faceIndex?'primitive-mismatch':sample.side!==side?'surface-side-mismatch':
      sample.identity.geometry!==identity.geometry||sample.identity.lighting!==identity.lighting?'stale-generation':
      sample.identity.source!==identity.source||sample.identity.bounces!==identity.bounces?'source-or-bounce-mismatch':
      sample.rgb.length!==3||!sample.rgb.every(Number.isFinite)?'invalid-radiance':undefined
    if(reason){reasons[reason]=(reasons[reason]??0)+1;observe?.(i,null,hit,direction);continue}
    known++
    observe?.(i,sample.rgb,hit,direction)
    for(let c=0;c<3;c++){sum[c]+=sample.rgb[c];square[c]+=sample.rgb[c]**2}
  }
  if(cancelled())return {state:'cancelled',rays:traced,irradiance:null}
  const complete=known===rays
  // Unknown surfaces are not black and must not be discarded/renormalized.
  // A partial result is never eligible to replace or supplement production GI.
  return {state:complete?'ready' as const:'incomplete' as const,rays:traced,hits,known,confidence:known/rays,reasons,
    irradiance:complete?sum.map(v=>v*Math.PI/rays):null,
    standardError:complete&&rays>1?sum.map((v,c)=>Math.PI*Math.sqrt(Math.max(0,(square[c]-v*v/rays)/(rays*(rays-1))))):null,
    traceMs,lookupMs,totalMs:performance.now()-started,identity}
}
