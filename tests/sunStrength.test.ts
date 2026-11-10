import test from 'node:test'
import assert from 'node:assert/strict'
import {DataUtils,Vector3} from 'three'
import {normalizeSunStrength} from '../src/sunStrength.ts'
import {indirectProjectKey,indirectLightingSettingsKey,validIndirectLightingSettings,type IndirectLightingSettings} from '../src/indirectLightingPersistence.ts'
import {daylightEnvironmentPixels} from '../src/daylightEnvironmentPixels.ts'

test('old projects keep 1x sun; supported source scales include zero and reject invalid values',()=>{
 for(const x of [undefined,NaN,Infinity,'2'])assert.equal(normalizeSunStrength(x),1)
 for(const x of [0,.5,1,2,4])assert.equal(normalizeSunStrength(x),x)
 assert.equal(normalizeSunStrength(-1),0);assert.equal(normalizeSunStrength(8),4)
 const p={floors:[],sunPosition:{azimuth:.2,elevation:.5}}
 assert.equal(indirectProjectKey(p),indirectProjectKey({...p,sunPosition:{...p.sunPosition,strength:1}}))
 for(const strength of [0,.5,2,4])assert.notEqual(indirectProjectKey(p),indirectProjectKey({...p,sunPosition:{...p.sunPosition,strength}}))
})
test('independent sky calibration invalidates GI caches without invalidating the legacy 1x default',()=>{
 const s:IndirectLightingSettings={daylight:true,lights:true,shadows:true,lightShadows:false,hideRoofs:false,floorSlabs:true,ambientTerm:.18,softAmbientShading:true,softAmbientStrength:1,groundPlane:true}
 assert.equal(indirectLightingSettingsKey(s),indirectLightingSettingsKey({...s,skyStrength:1}))
 for(const skyStrength of [0,2]){assert.equal(validIndirectLightingSettings({...s,skyStrength}),true);assert.notEqual(indirectLightingSettingsKey(s),indirectLightingSettingsKey({...s,skyStrength}))}
 assert.equal(validIndirectLightingSettings({...s,skyStrength:NaN}),false)
})
test('sky and sun-lit ground scale independently in the display environment',()=>{
 const base=new Uint16Array([1,2,3,1].map(DataUtils.toHalfFloat)),ground=new Uint16Array([.5,.5,.5,1].map(DataUtils.toHalfFloat)),sun=new Vector3(2,4,6)
 const decode=(a:Uint16Array)=>Array.from(a,DataUtils.fromHalfFloat)
 assert.deepEqual(decode(daylightEnvironmentPixels(base,ground,sun)),[2,4,6,1])
 assert.deepEqual(decode(daylightEnvironmentPixels(base,ground,sun,0)),[1,2,3,1])
 assert.deepEqual(decode(daylightEnvironmentPixels(base,ground,sun,2)),[3,6,9,1])
})
