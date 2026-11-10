import test from 'node:test'
import assert from 'node:assert/strict'
import {installUniformArrayExperiment} from './browser/rendererAuditUniformArrays.js'
const uniform=(id,type=0x1406,size=3)=>({id,type,size,writes:[],setValue(gl,v){this.writes.push(structuredClone(v))}})
function fixture(...uniforms){return{info:{programs:uniforms.map(u=>({getUniforms:()=>({seq:[u]})}))}}}
test('shared array values cache independently for each linked program and observe in-place edits',()=>{
 const a=uniform('hdPointLightRoomIds'),b=uniform('hdPointLightRoomIds'),cache=installUniformArrayExperiment(fixture(a,b)),v=new Float32Array([1,2,3]);cache.set(true)
 for(const u of [a,b]){u.setValue(null,v);u.setValue(null,v)}
 assert.equal(a.writes.length,1);assert.equal(b.writes.length,1)
 v[1]=8;for(const u of [a,b])u.setValue(null,v)
 assert.equal(a.writes.length,2);assert.equal(b.writes.length,2);assert.equal(a.writes[1][1],8)
 cache.dispose();a.setValue(null,v);assert.equal(a.writes.length,3)
})
test('vector and matrix arrays detect component edits and replacements without relying on identity',()=>{
 const a=uniform('hdGIFloorRanges',0x8b50,2),b=uniform('pointShadowMatrix',0x8b5c,1),cache=installUniformArrayExperiment(fixture(a,b));cache.set(true)
 const v=[{x:1,y:2},{x:3,y:4}],m=[{elements:Array.from({length:16},(_,i)=>i)}]
 a.setValue(null,v);a.setValue(null,[{x:1,y:2},{x:3,y:4}]);assert.equal(a.writes.length,1)
 v[1].y=7;a.setValue(null,v);assert.equal(a.writes.length,2)
 b.setValue(null,m);b.setValue(null,m);m[0].elements[14]=20;b.setValue(null,m);assert.equal(b.writes.length,2)
 cache.reset();a.setValue(null,v);assert.equal(a.writes.length,3)
})
test('samplers and per-object transforms retain their original setters',()=>{
 const a=uniform('pointShadowMap',0x8dc5,2),b=uniform('modelViewMatrix',0x8b5c,1),first=a.setValue,second=b.setValue
 const cache=installUniformArrayExperiment(fixture(a,b));cache.set(true)
 assert.equal(a.setValue,first);assert.equal(b.setValue,second);assert.equal(cache.stats.entries,0)
})
test('baseline bypass, signed zero, unknown data and newly compiled programs stay coherent',()=>{
 const a=uniform('hdRoomLightFloorHeights',0x1406,1),r=fixture(a),cache=installUniformArrayExperiment(r)
 cache.set(true);a.setValue(null,[0]);a.setValue(null,[-0]);assert.equal(a.writes.length,2)
 cache.set(false);a.setValue(null,[3]);cache.set(true);a.setValue(null,[0]);assert.equal(a.writes.length,4)
 a.setValue(null,[NaN]);a.setValue(null,[NaN]);assert.equal(a.writes.length,6)
 const b=uniform('hdPointLightRoomIds');r.info.programs.push({getUniforms:()=>({seq:[b]})});cache.patchPrograms();b.setValue(null,[1,2,3]);b.setValue(null,[1,2,3]);assert.equal(b.writes.length,1)
})
