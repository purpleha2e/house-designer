import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Mesh, Vector3 } from 'three'
import { createWindowDesign, getWindowLayout, updateWindowSection, validateWindowDesign, windowPreset,
  type WindowDesign } from '../src/windowDesign.ts'
import { createWindowGeometry, disposeWindowGeometry } from '../src/windowGeometry.ts'
import { syncWallOpenings } from '../src/modelPlacement.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel } from '../src/types.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`)
function topLights(): WindowDesign {
  const d = createWindowDesign()
  d.layout = windowPreset(d, 2)
  for (const path of ['r.0','r.1']) d.layout = updateWindowSection(d.layout,path,s => ({kind:'split',axis:'y',ratio:.25,
    fixedFirst:.3,children:[{kind:'pane',opening:'top'},s]}))
  return d
}

test('one to four presets fill the frame with equal panes and no overlaps', () => {
  for (const n of [1,2,3,4]) {
    const d = createWindowDesign(); d.layout = windowPreset(d,n)
    assert.equal(validateWindowDesign(d),null)
    const {panes,dividers}=getWindowLayout(d)
    assert.equal(panes.length,n); assert.equal(dividers.length,n-1)
    panes.forEach(p=>near(p.width,panes[0].width))
    near(panes.reduce((sum,p)=>sum+p.width,0)+dividers.length*d.divider+2*d.frame,d.width)
    near(panes.at(-1)!.x+panes.at(-1)!.width,d.width-d.frame)
  }
})
test('nested top openings retain their physical height as the variety grows', () => {
  const d=topLights(), grown={...d,width:1.8,height:2}
  const before=getWindowLayout(d).panes, after=getWindowLayout(grown).panes
  assert.equal(after.length,4)
  near(after[0].height,.3); near(after[2].height,.3)
  near(after[1].height-before[1].height,.8)
  assert.ok(after[0].width>before[0].width)
  assert.deepEqual(JSON.parse(JSON.stringify(d)),d)
  const changed=updateWindowSection(d.layout,'r.0.0',()=>({kind:'pane',opening:'left'}))
  assert.notDeepEqual(changed,d.layout)
  assert.equal(getWindowLayout(d).panes[0].section.kind==='pane'&&getWindowLayout(d).panes[0].section.opening,'top')
})
test('individual vertical and horizontal separator widths preserve defaults, pane bounds and fixed top lights', () => {
  const d=topLights()
  d.layout=updateWindowSection(d.layout,'r',s=>s.kind==='split'?{...s,dividerWidth:.08}:s)
  d.layout=updateWindowSection(d.layout,'r.0',s=>s.kind==='split'?{...s,dividerWidth:.035}:s)
  assert.equal(validateWindowDesign(d),null)
  for (const height of [1.2,1.8]) {
    const resized={...d,height,divider:.065}
    const {panes,dividers}=getWindowLayout(resized)
    near(dividers[0].width,.08)
    near(dividers[1].height,.035)
    near(dividers[2].height,.065)
    near(panes[0].height,.3);near(panes[2].height,.3)
    near(panes[1].y,panes[0].y+panes[0].height+.035)
    near(panes[3].y,panes[2].y+panes[2].height+.065)
    near(panes[2].x,panes[0].x+panes[0].width+.08)
    near(panes[1].y+panes[1].height,height-resized.frame)
    near(panes[3].y+panes[3].height,height-resized.frame)
    const group=createWindowGeometry(resized)
    near(new Box3().setFromObject(group.getObjectByName('divider-r')!).getSize(new Vector3()).x,.08)
    near(new Box3().setFromObject(group.getObjectByName('divider-r.0')!).getSize(new Vector3()).y,.035)
    near(new Box3().setFromObject(group.getObjectByName('divider-r.1')!).getSize(new Vector3()).y,.065)
    disposeWindowGeometry(group)
  }
  const restored=JSON.parse(JSON.stringify(d)) as WindowDesign
  assert.deepEqual(getWindowLayout(restored),getWindowLayout(d))
  restored.layout=updateWindowSection(restored.layout,'r',s=>s.kind==='split'?{...s,dividerWidth:undefined}:s)
  near(getWindowLayout({...restored,divider:.07}).dividers[0].width,.07)
  near(getWindowLayout(d).dividers[0].width,.08)
})
test('individual separator widths reject invalid measurements and panes made too small', () => {
  const d=createWindowDesign();d.width=.4;d.layout=windowPreset(d,2)
  for (const dividerWidth of [0,-.02,.01,.201,NaN,Infinity]) {
    const layout=updateWindowSection(d.layout,'r',s=>s.kind==='split'?{...s,dividerWidth}:s)
    assert.match(validateWindowDesign({...d,layout})!,/Individual divider widths/)
  }
  const layout=updateWindowSection(d.layout,'r',s=>s.kind==='split'?{...s,dividerWidth:.2}:s)
  assert.match(validateWindowDesign({...d,layout})!,/at least 100 mm/)
})
test('invalid small panes, bad dimensions and malformed layouts cannot be saved', () => {
  const d=topLights()
  assert.match(validateWindowDesign({...d,height:.5})!,/at least 100 mm/)
  assert.ok(validateWindowDesign({...d,width:NaN}))
  assert.ok(validateWindowDesign({...d,depth:0}))
  assert.ok(validateWindowDesign({...d,color:'invalid'}))
  assert.ok(validateWindowDesign({...d,layout:{kind:'split',children:[]}}))
})
test('generated glass, frames, sashes and handles have physical dimensions after resizing', () => {
  const d=topLights()
  for (const height of [1.2,2]) {
    const group=createWindowGeometry({...d,height})
    const bounds=new Box3().setFromObject(group), size=bounds.getSize(new Vector3())
    near(size.x,d.width); near(size.y,height); near(bounds.min.y,0)
    assert.equal(group.children.filter(o=>o.name.startsWith('glass-')).length,4)
    assert.equal(group.children.filter(o=>o.name.startsWith('handle-top')).length,2)
    const top=group.getObjectByName('frame-top') as Mesh
    near(new Box3().setFromObject(top).getSize(new Vector3()).y,d.frame)
    assert.deepEqual(group.userData.windowDesign,{...d,height})
    disposeWindowGeometry(group)
  }
})
test('changing a shared variety updates all wall cuts while other varieties retain their size', () => {
  const definition: ModelDefinition={id:'custom-window-test',name:'Test',category:'My windows',shape:'box',wallMount:'window',
    width:1.2,height:1.2,depth:.08,color:'#ffffff',windowDesign:topLights()}
  const other={...definition,id:'other'}
  const models=new Map([[definition.id,definition],[other.id,other]])
  const floor:FloorLevel={id:'f',name:'Test',elevation:0,roomHeight:3,slabThickness:.2,rooms:[],
    walls:[{id:'wall',start:{x:0,y:0},end:{x:12,y:0},height:3,thickness:.2,kind:'external'}],
    models:[definition.id,definition.id,other.id].map((modelId,i)=>({id:`w${i}`,modelId,position:{x:2+i*4,y:0},rotation:0,scale:1,
      wallOpeningBottom:.8,wallAttachment:{wallId:'wall',offset:2+i*4,side:1}}))}
  const before=syncWallOpenings(floor,models)
  models.set(definition.id,{...definition,width:1.8,height:1.5,windowDesign:{...topLights(),width:1.8,height:1.5}})
  const after=syncWallOpenings(before,models)
  after.walls[0].openings!.forEach((o,i) => {near(o.width,i<2?1.8:1.2);near(o.height,i<2?1.5:1.2)})
  assert.deepEqual(after.models,floor.models,'variety update preserves placements and sill heights')
})
