import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser=await lightingBrowser(), output='tmp/wall-batching'
mkdirSync(output,{recursive:true})
const report={}
try {
  await browser.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&basic-scene&opaque-materials&strict'})
  await browser.wait('window.basicSceneReport?.gpuCompleteMs !== undefined')
  await browser.evaluate(`window.inspectWallBatches=()=>{
    const meshes=[];roofWallScene().scene.traverse(o=>{if(o.userData.wallSurfaceBatch)meshes.push(o)})
    return {batches:meshes.length,triangles:meshes.reduce((n,o)=>n+o.geometry.index.count/3,0),
      redTriangles:meshes.filter(o=>o.material.color.getHexString()==='c80d56').reduce((n,o)=>n+o.geometry.index.count/3,0),
      pickCount:regressionPickTargets().filter(t=>t.object.userData.houseDesignerRole==='gable-pick').length}
  }`)
  report.initial=await browser.evaluate('inspectWallBatches()')
  assert.ok(report.initial.batches>0&&report.initial.pickCount>report.initial.batches)
  report.edit=await browser.evaluate(`(async()=>{
    const {roofSurfaceTargetsMatch}=await import('/src/roofMaterialAssignments.ts')
    const picks=regressionPickTargets().filter(t=>t.kind==='surface'&&t.object.userData.houseDesignerRole==='gable-pick'&&t.surface.type==='roof')
    const target=picks.find(t=>t.surface.part==='gable-interior')??picks[0]
    if(!target)throw Error('Missing gable pick surface')
    window.originalWallBatchAssignments=regressionAssignments
    const expected=picks.filter(t=>roofSurfaceTargetsMatch(t.surface,target.surface)).reduce((n,t)=>n+(t.object.geometry.index?.count??t.object.geometry.attributes.position.count)/3,0)
    updateRegressionAssignments([...regressionAssignments,{id:'batch-edit',materialId:'dulux-timeless-matt',customColor:'#c80d56',target:target.surface}])
    return {expected,surface:target.surface}
  })()`)
  await browser.wait(`inspectWallBatches().redTriangles===${report.edit.expected}`)
  report.painted=await browser.evaluate('inspectWallBatches()')
  assert.equal(report.painted.triangles,report.initial.triangles)
  assert.equal(report.painted.pickCount,report.initial.pickCount)
  await browser.evaluate('updateRegressionAssignments(originalWallBatchAssignments)')
  await browser.wait(`inspectWallBatches().redTriangles===0&&inspectWallBatches().batches===${report.initial.batches}`)
  report.restored=await browser.evaluate('inspectWallBatches()')
  assert.deepEqual(report.restored,report.initial)
  await browser.evaluate(`window.batchCheckbox=text=>[...document.querySelectorAll('label')].find(label=>label.textContent.trim()===text)?.querySelector('input');
    [...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='3D view menu')?.click()`)
  await browser.wait('!!batchCheckbox("Fade nearby roofs (1.5 m)")')
  await browser.evaluate('batchCheckbox("Fade nearby roofs (1.5 m)").click()')
  await browser.wait('inspectWallBatches().batches===0&&inspectWallBatches().pickCount===0')
  report.fade=await browser.evaluate(`(()=>{const meshes=[];roofWallScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-infill')meshes.push(o)});return {surfaces:meshes.length,visibleMaterials:meshes.filter(o=>o.material.visible).length}})()`)
  assert.equal(report.fade.surfaces,report.initial.pickCount)
  assert.equal(report.fade.visibleMaterials,report.fade.surfaces)
  await browser.evaluate('batchCheckbox("Fade nearby roofs (1.5 m)").click()')
  await browser.wait(`inspectWallBatches().batches===${report.initial.batches}`)
  await browser.evaluate('batchCheckbox("Wireframe").click()')
  await browser.wait('inspectWallBatches().batches===0&&inspectWallBatches().pickCount===0')
  await browser.evaluate('batchCheckbox("Wireframe").click()')
  await browser.wait(`inspectWallBatches().batches===${report.initial.batches}`)
  await browser.evaluate('batchCheckbox("Hide roofs").click()')
  await browser.wait('inspectWallBatches().batches===0&&inspectWallBatches().pickCount===0')
  await browser.evaluate('batchCheckbox("Hide roofs").click()')
  await browser.wait(`inspectWallBatches().batches===${report.initial.batches}`)
  report.final=await browser.evaluate('inspectWallBatches()')
  assert.deepEqual(report.final,report.initial)
  assert.deepEqual(browser.errors,[])
  console.log(JSON.stringify(report))
} finally {
  writeFileSync(`${output}/edits.json`,JSON.stringify({...report,errors:browser.errors},null,2))
  browser.close()
}
