import assert from 'node:assert/strict'
import test from 'node:test'
import { DataUtils } from 'three'
import { createSceneLightingReference, type ReferenceSceneData } from './sceneLightingReference.ts'

function empty(): ReferenceSceneData {
  return { positions: new Float32Array(), uvs: new Float32Array(), materialIndices: new Uint16Array(), materials: [], textures: [],
    skyBase: [.65, .72, .82], skySun: [0, 0, 0], skyMode: 'clear', sunDirection: [0, .8, -.6], sunIrradiance: [3, 3, 3], daylightGain: 1, lights: [] }
}
test('directional incoming samples preserve a pre-scaled sky without applying daylight gain again',()=>{
 const data=empty();data.skyBase=[2.275,2.52,2.87];data.daylightGain=3.5
 const reference=createSceneLightingReference(data)
 try{const [sample]=reference.incoming([0,0,0],[[0,1,0]],1,0);for(let c=0;c<3;c++)assert.ok(Math.abs(sample.radiance[c]-data.skyBase[c]*1.4)<1e-12);assert.deepEqual(sample.sky,sample.radiance)}finally{reference.dispose()}
})

test('independent scene reference integrates the analytic hemisphere and opposite window reveals', () => {
  const reference = createSceneLightingReference(empty())
  try {
    const up = reference.evaluate({ name: 'up', position: [0, 0, 0], normal: [0, 1, 0], geometricNormal: [0, 1, 0] }, 32768, 0)
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(up.sky[c] - [.65, .72, .82][c] * Math.PI * 17 / 15) < 4 * up.skyStandardError[c] + .00001)
    const left = reference.evaluate({ name: 'left reveal', position: [0, 0, 0], normal: [0, 0, 1], geometricNormal: [0, 0, 1] }, 16, 0)
    const right = reference.evaluate({ name: 'right reveal', position: [0, 0, 0], normal: [0, 0, -1], geometricNormal: [0, 0, -1] }, 16, 0)
    assert.deepEqual(left.direct, [0, 0, 0])
    for (const value of right.direct) assert.ok(Math.abs(value - 1.8) < 1e-12)
    assert.deepEqual(up.reflected, [0, 0, 0])
  } finally { reference.dispose() }
})

test('actual-scene reference separates textured reflected sunlight and applies daylight gain only once', () => {
  const data = empty()
  data.positions = new Float32Array([1, -100, -100, 1, -100, 100, 1, 100, 100, 1, -100, -100, 1, 100, 100, 1, 100, -100])
  data.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
  data.materialIndices = new Uint16Array([0, 0])
  data.materials = [{ color: [1, 1, 1], metalness: 0, map: 0, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], wrapS: 1000, wrapT: 1000 }]
  data.textures = [{ width: 1, height: 1, pixels: new Uint16Array([.25, .25, .25, 1].map(DataUtils.toHalfFloat)) }]
  data.skyBase = [0, 0, 0]; data.sunDirection = [-1, 0, 0]; data.daylightGain = 2
  const reference = createSceneLightingReference(data)
  try {
    const receiver = { name: 'receiver', position: [0, 0, 0], normal: [1, 0, 0], geometricNormal: [1, 0, 0] }
    const first = reference.evaluate(receiver, 16384, 1)
    assert.deepEqual(first.direct, [0, 0, 0])
    assert.deepEqual(first.sky, [0, 0, 0])
    for (const value of first.reflected) assert.ok(Math.abs(value - 1.5) < .003)
    for(const value of reference.incoming([0,0,0],[[1,0,0]],1,0)[0].firstPass)assert.ok(Math.abs(value-1.5/Math.PI)<1e-12)
    assert.deepEqual(reference.evaluate(receiver, 16, 0).reflected, [0, 0, 0])
    const source=data.sunIrradiance.slice()
    data.sunIrradiance=source.map(v=>v*2) as [number,number,number]
    const doubled=reference.evaluate(receiver,16384,1)
    assert.ok(doubled.reflected.every((v,c)=>Math.abs(v-2*first.reflected[c])<1e-10))
    data.sunIrradiance=[0,0,0]
    assert.deepEqual(reference.evaluate(receiver,16384,1).reflected,[0,0,0])
  } finally { reference.dispose() }
})

test('explicit encounter limit excludes the extra escaped-sky path after the final transport pass',()=>{
 const data=empty();data.sunIrradiance=[0,0,0]
 data.positions=new Float32Array([1,-100,-100,1,-100,100,1,100,100,1,-100,-100,1,100,100,1,100,-100])
 data.uvs=new Float32Array(12);data.materialIndices=new Uint16Array([0,0])
 data.materials=[{color:[.5,.5,.5],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1000,wrapT:1000}]
 const reference=createSceneLightingReference(data),receiver={name:'receiver',position:[0,0,0],normal:[1,0,0],geometricNormal:[1,0,0]}
 try{
  const first=reference.evaluate(receiver,4096,6,1234,1),second=reference.evaluate(receiver,4096,6,1234,2)
  assert.deepEqual(first.reflected,[0,0,0]);assert.ok(second.reflected.every(v=>v>.1))
  assert.equal(first.maxEncounters,1);assert.equal(first.rays,4096);assert.ok(second.rays>first.rays)
  assert.deepEqual(reference.incoming([0,0,0],[[1,0,0]],64,6,1234,false,1)[0].radiance,[0,0,0])
  assert.ok(reference.incoming([0,0,0],[[1,0,0]],64,6,1234,false,2)[0].radiance.every(v=>v>.1))
 }finally{reference.dispose()}
})
