/** Fingerprints are only an index. Every accepted vertex is checked within the
 * stated Float32 transform tolerance; ambiguous material/UV/tag matches fail. */
export function mapSunTriangles(geometry:Float32Array,reference:Float32Array,materialIndices:Uint16Array,uvs:Float32Array,categories?:Uint8Array,epsilon=0,materials?:readonly unknown[]){
 const signatures=materials?.map(m=>JSON.stringify(m))
 const equivalent=(a:number,b:number)=>a===b||!!signatures&&signatures[a]===signatures[b]
 const textured=(id:number)=>!materials||(materials[id] as {map?:number}).map!==-1
 const count=materialIndices.length,capacity=2**Math.ceil(Math.log2(Math.max(2,count*2))),head=new Int32Array(capacity).fill(-1),next=new Int32Array(count),bitsG=new Uint32Array(geometry.buffer,geometry.byteOffset,geometry.length),bitsR=new Uint32Array(reference.buffer,reference.byteOffset,reference.length),quantum=epsilon*1000
 const key=(a:Float32Array,bits:Uint32Array,t:number)=>{let sum=0,xor=0;for(let v=0;v<3;v++){let h=2166136261;for(let k=0;k<3;k++){const i=t*9+v*3+k,value=epsilon?Math.round(a[i]/quantum):(bits[i]||0);h=Math.imul(h^value,16777619)}sum=(sum+h)>>>0;xor^=h}return(Math.imul(sum,31)^xor)&(capacity-1)}
 const match=(t:number,r:number)=>{const ids:number[]=[],used=[false,false,false];for(let v=0;v<3;v++){let found=-1;for(let j=0;j<3;j++){if(used[j])continue;let equal=true;for(let k=0;k<3;k++)if(Math.abs(geometry[t*9+v*3+k]-reference[r*9+j*3+k])>epsilon)equal=false;if(equal){found=j;break}}if(found<0)return null;ids.push(found);used[found]=true}return ids}
 for(let t=0;t<count;t++){const bucket=key(reference,bitsR,t);next[t]=head[bucket];head[bucket]=t}
 const triangles=Math.floor(geometry.length/9),mapping=new Int32Array(triangles).fill(-1),stats={geometryTriangles:triangles,referenceTriangles:count,mapped:0,unmapped:0,ambiguous:0,equivalentDuplicates:0,maximumVertexError:0,vertexTolerance:epsilon}
 for(let t=0;t<triangles;t++){
  const bucket=key(geometry,bitsG,t);let selected=-1,selectedOrder:number[]|null=null,ambiguous=false
  for(let r=head[bucket];r>=0;r=next[r]){const ids=match(t,r);if(!ids)continue
   if(selected>=0){if(!equivalent(materialIndices[selected],materialIndices[r])||(categories&&categories[selected]!==categories[r]))ambiguous=true;if(textured(materialIndices[r]))for(let v=0;v<3;v++)for(let k=0;k<2;k++)if(uvs[selected*6+selectedOrder![v]*2+k]!==uvs[r*6+ids[v]*2+k])ambiguous=true;stats.equivalentDuplicates++}else{selected=r;selectedOrder=ids}
  }
  if(ambiguous){stats.ambiguous++;continue}if(selected<0){stats.unmapped++;continue}
  mapping[t]=selected;stats.mapped++;for(let v=0;v<3;v++)for(let k=0;k<3;k++)stats.maximumVertexError=Math.max(stats.maximumVertexError,Math.abs(geometry[t*9+v*3+k]-reference[selected*9+selectedOrder![v]*3+k]))
 }
 return{mapping,stats}
}
