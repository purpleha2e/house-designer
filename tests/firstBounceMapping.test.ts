import test from 'node:test'
import assert from 'node:assert/strict'
import {mapSunTriangles} from './firstBounceMapping.ts'
const tri=[1,0,0,1,1,0,1,0,1],other=tri.map((v,i)=>i%3===0?v+1:v),uv=[0,0,1,0,0,1]
test('primitive fingerprints recover actual triangles across traversal and corner-order changes',()=>{
 const result=mapSunTriangles(new Float32Array([...other,...tri.slice(3),...tri.slice(0,3)]),new Float32Array([...tri,...other]),new Uint16Array([0,1]),new Float32Array([...uv,...uv]))
 assert.deepEqual(Array.from(result.mapping),[1,0]);assert.equal(result.stats.mapped,2)
})
test('Float32 transform tolerance is explicit and cannot jump to a nearby thin wall',()=>{
 const geometry=new Float32Array(tri.map((v,i)=>i%3===0?v+.0000005:v)),ref=new Float32Array(tri),m=new Uint16Array([0]),coords=new Float32Array(uv)
 assert.equal(mapSunTriangles(geometry,ref,m,coords,undefined,.000005).stats.mapped,1)
 const wall=new Float32Array(tri.map((v,i)=>i%3===0?v+.001:v));assert.equal(mapSunTriangles(wall,ref,m,coords,undefined,.000005).stats.mapped,0)
})
test('overlapping triangles with different material, source or textured UVs remain unsupported',()=>{
 const g=new Float32Array(tri),r=new Float32Array([...tri,...tri]),u=new Float32Array([...uv,...uv])
 assert.equal(mapSunTriangles(g,r,new Uint16Array([0,1]),u).stats.ambiguous,1)
 assert.equal(mapSunTriangles(g,r,new Uint16Array([0,0]),u,new Uint8Array([0,1])).stats.ambiguous,1)
 u[6]=.2;assert.equal(mapSunTriangles(g,r,new Uint16Array([0,0]),u).stats.ambiguous,1)
})
test('radiance-equivalent untextured duplicates do not manufacture ambiguity from unused UVs',()=>{
 const material={color:[1,1,1],metalness:0,map:-1},r=mapSunTriangles(new Float32Array(tri),new Float32Array([...tri,...tri]),new Uint16Array([0,1]),new Float32Array([...uv,...uv.map(x=>x*.5)]),undefined,.000005,[material,{...material}])
 assert.equal(r.stats.mapped,1);assert.equal(r.stats.ambiguous,0)
})
