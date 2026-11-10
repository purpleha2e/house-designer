import {Box3,Vector3} from 'three'
import {INDIRECT_ATLAS_SIZE,INDIRECT_MAX_LOCAL_LIGHTS,INDIRECT_CONTACT_PROBE_BUDGET,writeIndirectPosition,type IndirectField} from './indirectLighting.ts'
import type {IndirectVisibility} from './indirectVisibility.ts'
import {pointIsInsideRoomPolygon} from './roomLightMask.ts'

export const INDIRECT_ADDITIONAL_PROBE_BUDGET=128
export {INDIRECT_CONTACT_PROBE_BUDGET} from './indirectLighting.ts'
export const INDIRECT_CONTACT_RADIUS=.6
export const INDIRECT_CONTACT_CAPTURE_NEAR=.002
export function requestedIndirectContacts(){return typeof location!=='undefined'&&new URLSearchParams(location.search).get('giContacts')==='local'}
const axes=[new Vector3(1,0,0),new Vector3(-1,0,0),new Vector3(0,1,0),new Vector3(0,-1,0),new Vector3(0,0,1),new Vector3(0,0,-1)]
const diagonals:Vector3[]=[]
for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(Math.abs(x)+Math.abs(y)+Math.abs(z)>1)diagonals.push(new Vector3(x,y,z).normalize())
export type IndirectContactSeed={position:number[];gap:number;area:number;receiver?:number[];normal?:number[];missingSupport?:boolean}
type Candidate={position:Vector3;region:IndirectField['regions'][number];score:number;distance:number;gap:number;floor:boolean;priority:number;coverage:{index:number;weight:number}[]}

/** Spend part of the existing additional-probe budget on small usable air
 * pockets. Geometric support from a distant probe does not measure their local
 * radiance. Neither measured brightness nor room labels classify occlusion. */
export function addIndirectContactProbes(field:IndirectField,boxes:Box3[],visibility:IndirectVisibility,seeds:IndirectContactSeed[]=[],trace?:{prepared?:(buckets:Candidate[][],seeds:IndirectContactSeed[],frequency:Float32Array)=>void;selected?:(candidate:Candidate,score:number)=>void}){
 const limit=INDIRECT_ATLAS_SIZE**2-INDIRECT_MAX_LOCAL_LIGHTS,used=new Set(field.probes.map(p=>p.index)),origin=new Vector3(),delta=new Vector3(),normal=new Vector3(),edge=new Vector3(),point=new Vector3()
 // Collapse tessellation within a 4 cm air neighbourhood before ranking.
 // Keep separate records across actual surfaces, including thin panels.
 const compact:IndirectContactSeed[]=[],compactBins=new Map<string,number[]>()
 for(const seed of seeds){point.fromArray(seed.position);const key=seed.position.map(v=>Math.floor(v/.04)).join(':'),bin=compactBins.get(key)??[]
  const found=bin.find(i=>{const previous=compact[i];if(Math.max(seed.gap,previous.gap)>Math.min(seed.gap,previous.gap)*1.25)return false
   if(seed.normal&&previous.normal&&new Vector3().fromArray(seed.normal).dot(new Vector3().fromArray(previous.normal))<.9)return false
   origin.fromArray(previous.position);delta.subVectors(point,origin);const d=delta.length();return d<.001||!visibility.hit(origin,delta.divideScalar(d),Math.max(.0001,d-.0002),.0001)})
  if(found!==undefined){compact[found].area+=seed.area;if(seed.gap<compact[found].gap){compact[found].position=seed.position;compact[found].gap=seed.gap;compact[found].receiver=seed.receiver;compact[found].normal=seed.normal}}
  else{bin.push(compact.length);compact.push({...seed});compactBins.set(key,bin)}
 }seeds=compact.filter(seed=>{
  if(!seed.receiver||!seed.normal)return true
  point.fromArray(seed.receiver).addScaledVector(new Vector3().fromArray(seed.normal),.001)
  // Spend the limited surface captures on faces exposed to the room's free
  // air, rather than on inaccessible seams inside a furniture assembly.
  const visible=(p:Vector3)=>field.probes.some(probe=>{origin.copy(probe.position);delta.subVectors(p,origin);const d=delta.length();return d<field.spacing*1.75&&(d<.001||!visibility.occluded(origin,delta.divideScalar(d),d-.0002,.0001))})
  if(visible(point)){
   const receiver=new Vector3().fromArray(seed.receiver),n=new Vector3().fromArray(seed.normal),range=field.ranges.find(r=>receiver.y>=r.bottom&&receiver.y<r.top)
   if(range){const step=field.bounds.size/(field.volume.n-1),floorReceiver=n.y>.9&&receiver.y>=range.bottom+.04&&receiver.y<=range.bottom+.14,bias=floorReceiver?.004:.02+(Math.abs(n.x)+Math.abs(n.z))*step+Math.abs(n.y)*(range.top-range.bottom)/11
    seed.missingSupport=!visible(receiver.addScaledVector(n,bias))
   }
   return true
  }
  // A visible narrow seam can be hidden from every coarse grid probe. Test
  // escape from its actual receiver too, instead of discarding the missing
  // measurements precisely where the regular grid has no visibility.
  const box=boxes.find(b=>b.clone().expandByScalar(.02).containsPoint(point));if(!box)return false
  return [...axes,...diagonals].some(axis=>{const h=visibility.hit(point,axis,Math.max(1,box.getSize(new Vector3()).length()),.0001);return !h||!box.containsPoint(h.point)})
 })
 const seedPositions=seeds.map(s=>new Vector3().fromArray(s.position)),receivers=seeds.map(s=>s.receiver&&s.normal?new Vector3().fromArray(s.receiver).addScaledVector(new Vector3().fromArray(s.normal),.001):new Vector3().fromArray(s.position)),seedBins=new Map<string,number[]>(),covered=new Float32Array(seeds.length),coverageRadius=INDIRECT_CONTACT_RADIUS
 seedPositions.forEach((p,i)=>{const key=[p.x,p.y,p.z].map(v=>Math.floor(v/coverageRadius)).join(':');const bin=seedBins.get(key)??[];bin.push(i);seedBins.set(key,bin)})
 let index=Math.max(field.floors.length*field.n*field.n*2,...used,0)+1,added=0
 const ordered=[...boxes].map(b=>b.clone()).sort((a,b)=>a.min.y-b.min.y||a.min.x-b.min.x||a.min.z-b.min.z||a.max.x-b.max.x||a.max.z-b.max.z),buckets:Candidate[][]=[]
 // Contiguous kitchen units describe one contact neighbourhood. Treating
 // every door as a separate allocation starves freestanding furniture.
 for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++)if(ordered[i].clone().expandByScalar(.08).intersectsBox(ordered[j])){ordered[i].union(ordered[j]);ordered.splice(j,1);j=i}
 const nearestVisible=(p:Vector3,maxDistance=3)=>{
  let distance=maxDistance
  for(const probe of field.probes){origin.fromArray(field.positionData,probe.index*4);delta.subVectors(p,origin);const d=delta.length();if(d>=distance)continue
   if(d<.001||!visibility.hit(origin,delta.divideScalar(d),Math.max(.0001,d-.0002),.0001))distance=d
  }return distance
 }
 for(const box of ordered){
  const size=box.getSize(new Vector3());if(size.x<.3||size.y<.3||size.z<.3)continue
  const candidates:Candidate[]=[],seen=new Set<string>(),expanded=box.clone().expandByScalar(.08)
  const consider=(p:Vector3,gap:number,priority=1)=>{
   const key=p.toArray().map(v=>Math.round(v/.025)).join(':');if(seen.has(key))return;seen.add(key)
   const region=field.regions.find(r=>p.y>r.bottom+.035&&p.y<r.top-.02&&pointIsInsideRoomPolygon({x:p.x,y:p.z},r.polygon));if(!region)return
   // Closed solids exit through back faces in every direction. A single
   // back-facing hit is insufficient for open, double-sided upholstery.
   let exits=0,escape=!box.containsPoint(p)
   for(const axis of axes){const h=visibility.hit(p,axis,Math.max(1,size.length()),.0001);if(h?.distance!==undefined&&h.distance<.006)return
    if(h&&(h.face?.normal.dot(axis)??0)>.01)exits++
    if(!h||!box.containsPoint(h.point))escape=true
   }if(exits===axes.length)return
   // Air sealed inside a closed cupboard is not an exterior receiver pocket.
   // Preserve narrow openings between cushions by checking diagonals too.
   if(!escape)escape=diagonals.some(axis=>{const h=visibility.hit(p,axis,Math.max(1,size.length()),.0001);return !h||!box.containsPoint(h.point)})
   // A displacement-crossing seed can belong to a bent or very narrow air
   // passage. Lack of a straight escape along these 26 directions is not
   // proof that the passage is sealed or receives no diffuse bounce light.
   if(!escape&&priority<=1)return
   const distance=nearestVisible(p);if(distance<.45&&priority!==2&&priority!==8)return
   const score=distance*.08/Math.max(.08,gap)
   const floor=p.y-region.bottom<.15,coverage:Candidate['coverage']=[],cell=[p.x,p.y,p.z].map(v=>Math.floor(v/coverageRadius))
   if(!floor)for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const index of seedBins.get(`${cell[0]+x}:${cell[1]+y}:${cell[2]+z}`)??[]){
    if(seedPositions[index].y-region.bottom<.15)continue
    delta.subVectors(receivers[index],p);const d=delta.length(),radius=Math.max(.06,Math.min(coverageRadius,seeds[index].gap*3));if(d>=radius)continue
    if(d<.001||!visibility.hit(p,delta.divideScalar(d),Math.max(.0001,d-.0002),.0001))coverage.push({index,weight:(1-d*d/(radius*radius))**2})
   }
   // Floor discontinuities are seeded from physical feet below. Closed
   // assembly seams near floor level must not consume that separate quota.
   if(floor&&priority>1){seen.delete(key);return}
   candidates.push({position:p.clone(),region,score,distance,gap,floor,priority,coverage})
  }
  for(const seed of seeds){point.fromArray(seed.position);if(expanded.containsPoint(point))consider(point,seed.gap,seed.missingSupport?8:4)}
  visibility.trianglesInBox(box,(a,b,c)=>{
   point.copy(a).add(b).add(c).multiplyScalar(1/3);if(!expanded.containsPoint(point))return
   normal.crossVectors(delta.subVectors(b,a),edge.subVectors(c,a));if(normal.lengthSq()<1e-12)return;normal.normalize()
   if(Math.hypot(normal.x,normal.z)>.5)for(const floor of field.floors){
    const y=floor.elevation+.04,intersections:Vector3[]=[]
    for(const [v,w]of [[a,b],[b,c],[c,a]])if((v.y<=y&&w.y>y)||(w.y<=y&&v.y>y))intersections.push(v.clone().lerp(w,(y-v.y)/(w.y-v.y)))
    if(intersections.length===2){const seed=intersections[0].add(intersections[1]).multiplyScalar(.5),horizontal=new Vector3(normal.x,0,normal.z).normalize();seed.addScaledVector(horizontal,.06);consider(seed,.12)}
   }
   if(seeds.length)return
   point.copy(a).add(b).add(c).multiplyScalar(1/3)
   origin.copy(point).addScaledVector(normal,.0002)
   const h=visibility.hit(origin,normal,.3,.0001)
   if(!h||h.distance<.014)return
   const gap=h.distance;point.addScaledVector(normal,Math.min(.08,gap*.5));consider(point,gap)
  })
  // Low samples on both sides of narrow feet cover a spatial discontinuity
  // even when broad, distant kernels already report nominal support there.
  for(const floor of field.floors){if(box.max.y<floor.elevation+.14||box.min.y>floor.elevation+.8)continue
   for(let z=Math.ceil((box.min.z-.15)/.25);z<=Math.floor((box.max.z+.15)/.25);z++)for(let x=Math.ceil((box.min.x-.15)/.25);x<=Math.floor((box.max.x+.15)/.25);x++){
    point.set(x*.25,floor.elevation+.04,z*.25)
    const nearby=axes.filter(axis=>!axis.y).some(axis=>!!visibility.hit(point,axis,.2,.0001))
    if(nearby)consider(point,.2)
   }
  }
  // The wall immediately above a worktop needs its own side's radiance;
  // measurements sealed behind the cabinet cannot illuminate that receiver.
  for(let z=Math.ceil(box.min.z/.5);z<=Math.floor(box.max.z/.5);z++)for(let x=Math.ceil(box.min.x/.5);x<=Math.floor(box.max.x/.5);x++){
   point.set(x*.5,box.max.y+.08,z*.5)
   const wall=axes.filter(axis=>!axis.y).map(axis=>({axis,hit:visibility.hit(point,axis,.3,.0001)})).find(({hit})=>hit)
   if(wall?.hit){point.addScaledVector(wall.axis,Math.max(0,wall.hit.distance-.06));consider(point,.12,2)}
  }
  candidates.sort((a,b)=>b.score-a.score||a.position.x-b.position.x||a.position.y-b.position.y||a.position.z-b.position.z)
  if(candidates.length)buckets.push(candidates)
 }
 buckets.sort((a,b)=>b[0].score-a[0].score||a[0].position.x-b[0].position.x||a[0].position.z-b[0].position.z)
 // A small pocket with only one usable capture must not lose to a highly
 // tessellated surface with hundreds of equivalent capture positions.
 const frequency=new Float32Array(seeds.length)
 for(const bucket of buckets)for(const candidate of bucket)for(const link of candidate.coverage)frequency[link.index]+=link.weight
 trace?.prepared?.(buckets,seeds,frequency)
 // Spend captures on unresolved geometry, with a per-model limit and a
 // diminishing priority so one detailed asset cannot consume the allocation.
  const allocations=new Uint8Array(buckets.length),floorAllocations=new Uint8Array(buckets.length),wallAllocations=new Uint8Array(buckets.length),additional=field.probes.filter(p=>p.kind).length,channels=[0,0,0]
 let phase=0
 while(added<INDIRECT_CONTACT_PROBE_BUDGET&&additional+added<INDIRECT_ADDITIONAL_PROBE_BUDGET){
  let candidate:Candidate|undefined,best=0,selected=-1
  for(let i=0;i<buckets.length;i++){if(allocations[i]>=8)continue;for(const c of buckets[i]){const channel=c.floor?0:c.priority===2?1:2;if(channel!==(phase<2?phase:2)||channels[channel]>=(channel<2?16:INDIRECT_CONTACT_PROBE_BUDGET)||c.floor&&floorAllocations[i]>=1)continue
   const need=c.priority>1?Math.min(c.distance/.6,1):c.distance*.08/Math.max(.08,c.gap)
   const coverage=c.coverage.reduce((s,l)=>s+l.weight*(phase===2?(seeds[l.index].missingSupport&&covered[l.index]<.8?1:0):1-covered[l.index])/Math.max(.0001,frequency[l.index]),0)
   const score=(channel<2?c.priority*need:seeds.length?coverage*(phase===2?1:c.distance/Math.max(.02,c.gap)):phase===2?0:c.priority*need)/(1+(channel===1?wallAllocations[i]:allocations[i])*.5)
   const separation=channel<2?.25:Math.min(.25,Math.max(.04,c.gap*2))
   if(c.distance>=separation&&score>best){candidate=c;best=score;selected=i}
  }}if(!candidate){if(phase<3){phase++;continue}break}
  trace?.selected?.(candidate,best)
  while(used.has(index)&&index<limit)index++;if(index>=limit)return added
  field.probes.push({index,position:candidate.position,region:candidate.region,kind:'contact'});used.add(index);writeIndirectPosition(field.positionData,index++,candidate.position);added++
  allocations[selected]++
  channels[candidate.floor?0:candidate.priority===2?1:2]++
  if(candidate.floor)floorAllocations[selected]++
  if(candidate.priority===2)wallAllocations[selected]++
  for(const link of candidate.coverage)covered[link.index]=Math.max(covered[link.index],link.weight)
  for(const bucket of buckets)for(const c of bucket){delta.subVectors(c.position,candidate.position);const distance=delta.length();if(distance>=c.distance)continue
   if(distance<.001||!visibility.hit(candidate.position,delta.divideScalar(distance),Math.max(.0001,distance-.0002),.0001))c.distance=distance
  }
 }
 field.positions.needsUpdate=true
 return added
}

export function indirectContactKernel(distanceSquared:number){return Math.max(0,1-distanceSquared/(INDIRECT_CONTACT_RADIUS**2))**2}
export function indirectContactWeight(distanceSquared:number){return 1/(distanceSquared+.15**2)}
