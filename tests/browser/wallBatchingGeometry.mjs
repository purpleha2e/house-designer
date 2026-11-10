import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lightingBrowser } from './lightingHarness.mjs'

const mode = process.argv[2] ?? 'after', output = 'tmp/wall-batching'
mkdirSync(output, { recursive: true })
const browser = await lightingBrowser()
try {
  await browser.call('Page.navigate', {url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&basic-scene&opaque-materials'})
  await browser.wait('window.basicSceneReport?.gpuCompleteMs !== undefined')
  const data = await browser.evaluate(`(() => {
    const {scene} = roofWallScene(), triangles=[], picks=[], meshes=[]
    scene.updateMatrixWorld(true)
    const round=n=>Math.round(n*1e6)/1e6
    const walk=(mesh,callback)=>{
      const g=mesh.geometry,p=g.attributes.position,count=g.index?.count??p.count
      const groups=Array.isArray(mesh.material)?g.groups:[{start:0,count,materialIndex:0}]
      for(const group of groups)for(let i=group.start;i<group.start+group.count;i+=3){
        const vertices=[0,1,2].map(j=>{
          const k=g.index?.getX(i+j)??i+j
          const x=p.getX(k),y=p.getY(k),z=p.getZ(k),e=mesh.matrixWorld.elements
          const attributes=Object.entries(g.attributes).filter(([name])=>name!=='position').sort(([a],[b])=>a.localeCompare(b))
            .map(([name,a])=>[name,Array.from({length:a.itemSize},(_,c)=>round(a.getComponent(k,c)))])
          return [[round(e[0]*x+e[4]*y+e[8]*z+e[12]),round(e[1]*x+e[5]*y+e[9]*z+e[13]),round(e[2]*x+e[6]*y+e[10]*z+e[14])],attributes]
        })
        callback(vertices,group.materialIndex)
      }
    }
    scene.traverse(o=>{
      if(!o.isMesh||!['wall-engine-render','roof-infill'].includes(o.userData.houseDesignerRole))return
      meshes.push({role:o.userData.houseDesignerRole,solidGable:!!o.userData.solidGable,indexed:!!o.geometry.index,groups:o.geometry.groups.length,materials:Array.isArray(o.material)?o.material.length:1})
      walk(o,(vertices,index)=>{
        const m=Array.isArray(o.material)?o.material[index]:o.material
        const finish=[m.type,m.color?.getHexString(),m.roughness,m.metalness,m.side,m.shadowSide,m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits,
          ...['map','normalMap','roughnessMap','metalnessMap','aoMap'].map(key=>m[key]?[m[key].image?.src??m[key].name,...m[key].matrix.elements.map(round)]:null)]
        triangles.push(JSON.stringify([o.userData.houseDesignerRole,finish,vertices]))
      })
    })
    for(const target of regressionPickTargets()??[]){
      if(!target.object.isMesh||!['wall-engine-pick','roof-infill','gable-pick'].includes(target.object.userData.houseDesignerRole))continue
      walk(target.object,(vertices,index)=>{
        const surface=target.kind==='material-groups'?target.groupTargets.get(index):target.surface
        picks.push(JSON.stringify([surface,vertices]))
      })
    }
    return {triangles:triangles.sort(),picks:picks.sort(),meshes}
  })()`)
  const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex')
  const summary = { triangles:data.triangles.length,appearance:digest(data.triangles),picks:data.picks.length,picking:digest(data.picks),meshes:data.meshes,errors:browser.errors }
  writeFileSync(`${output}/${mode}.json`,JSON.stringify(summary,null,2))
  writeFileSync(`${output}/${mode}-triangles.json`,JSON.stringify(data))
  console.log(JSON.stringify(summary))
  if(mode==='after'){
    const before=JSON.parse(readFileSync(`${output}/before.json`))
    assert.equal(summary.triangles,before.triangles)
    assert.equal(summary.appearance,before.appearance,'triangle positions, normals, UVs, GI attributes and finishes must remain identical')
    assert.equal(summary.picks,before.picks)
    assert.equal(summary.picking,before.picking,'surface picking must remain identical')
  }
  assert.deepEqual(browser.errors,[])
} finally { browser.close() }
