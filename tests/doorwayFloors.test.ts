import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDoorwayFloorPatches } from '../src/doorwayFloors.ts'
import type { Point, Wall } from '../src/types.ts'

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [{ x:x0,y:y0 },{ x:x1,y:y0 },{ x:x1,y:y1 },{ x:x0,y:y1 }]
const wall: Wall = { id:'partition', kind:'internal', start:{x:2,y:0}, end:{x:2,y:4}, thickness:0.2, height:2.4,
  openings:[{id:'door',modelId:'interior-door',center:2,width:1,bottom:0,height:2.1}] }
const rooms = [{signature:'left',polygon:rectangle(0,0,1.9,4)}, {signature:'right',polygon:rectangle(2.1,0,4,4)}]
const area = (points: Point[]) => Math.abs(points.reduce((sum,p,i) => {
  const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y
},0))/2
const near = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`)

test('adjoining floor finishes each cover exactly half the doorway and meet on the wall centre', () => {
  const { patches, replacedPortals } = buildDoorwayFloorPatches([wall],rooms)
  assert.ok(replacedPortals.has('partition:door'))
  assert.equal(patches.length,2)
  for(const patch of patches){
    near(area(patch.outline),0.1)
    const xs=patch.outline.map(p=>p.x)
    near(patch.roomSignature==='left'?Math.max(...xs):Math.min(...xs),2)
    assert.ok(patch.outline.every(p=>p.y>=1.5&&p.y<=2.5))
  }
})

test('rotated and reversed walls preserve the room side and midpoint join', () => {
  const transform = (p:Point) => ({x:10+(p.x-p.y)/Math.SQRT2,y:5+(p.x+p.y)/Math.SQRT2})
  const rotated={...wall,start:transform(wall.end),end:transform(wall.start)}
  const result=buildDoorwayFloorPatches([rotated],rooms.map(r=>({...r,polygon:r.polygon.map(transform)})))
  assert.equal(result.patches.length,2)
  for(const patch of result.patches){
    near(area(patch.outline),0.1)
    const localX=patch.outline.map(p=>((p.x-10)+(p.y-5))/Math.SQRT2)
    near(patch.roomSignature==='left'?Math.max(...localX):Math.min(...localX),2)
  }
})

test('existing floor coverage and stair apertures are not covered by another coplanar patch', () => {
  const extended=[{...rooms[0],polygon:[{x:0,y:0},{x:1.9,y:0},{x:1.9,y:1.5},
    {x:2,y:1.5},{x:2,y:2.5},{x:1.9,y:2.5},{x:1.9,y:4},{x:0,y:4}]} , rooms[1]]
  const result=buildDoorwayFloorPatches([wall],extended,[rectangle(2,1.5,2.1,2)])
  assert.ok(result.replacedPortals.has('partition:door'))
  assert.equal(result.patches.length,1)
  assert.equal(result.patches[0].roomSignature,'right')
  near(area(result.patches[0].outline),0.05)
})

test('exterior thresholds and raised openings remain separate', () => {
  const external=buildDoorwayFloorPatches([{...wall,kind:'external'}],[rooms[0]])
  assert.equal(external.replacedPortals.size,0)
  const window=buildDoorwayFloorPatches([{...wall,openings:wall.openings!.map(o=>({...o,bottom:1}))}],rooms)
  assert.equal(window.patches.length,0)
  assert.equal(window.replacedPortals.size,0)
})

test('a 100 mm external-labelled partition joins both room floors without a threshold', () => {
  const partition: Wall = { ...wall, kind: 'external', thickness: 0.1 }
  const adjoining = [
    { signature: 'left', polygon: rectangle(0, 0, 1.95, 4) },
    { signature: 'right', polygon: rectangle(2.05, 0, 4, 4) },
  ]
  const { patches, replacedPortals } = buildDoorwayFloorPatches([partition], adjoining)
  assert.ok(replacedPortals.has('partition:door'), 'the separate white threshold must be suppressed')
  assert.equal(patches.length, 2)
  for (const patch of patches) {
    near(area(patch.outline), 0.05)
    const xs = patch.outline.map(p => p.x)
    near(Math.min(...xs), patch.roomSignature === 'left' ? 1.95 : 2)
    near(Math.max(...xs), patch.roomSignature === 'left' ? 2 : 2.05)
  }
})

test('an external wall with the same room on both sides retains its threshold', () => {
  const surrounding = [{ signature: 'room', polygon: rectangle(0, 0, 4, 4) }]
  assert.equal(buildDoorwayFloorPatches([{ ...wall, kind: 'external' }], surrounding).replacedPortals.size, 0)
})

test('overlapping openings do not produce duplicate floor surfaces and deleted doors leave no extension', () => {
  const overlapping={...wall,openings:[...wall.openings!,{...wall.openings![0],id:'second',center:2.25}]}
  const result=buildDoorwayFloorPatches([overlapping],rooms)
  near(result.patches.reduce((sum,p)=>sum+area(p.outline),0),0.25)
  assert.equal(buildDoorwayFloorPatches([{...wall,openings:[]}],rooms).patches.length,0)
})
