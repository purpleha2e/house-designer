import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const b = await lightingBrowser(), output = 'tmp/window-clearance-rulers', report = {}
mkdirSync(output, { recursive: true })
try {
  await b.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?lighting-startup&selection-shaders` })
  await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&!roofWallScene().scene.userData.shaderWarmupPending`)
  await b.evaluate(`selectRegressionModel('selection-window-1');const s=roofWallScene();s.camera.position.set(3,1.7,-6);s.camera.lookAt(3,1.2,0);s.camera.updateMatrixWorld();s.invalidate()`)
  await b.wait(`!!document.querySelector('[data-window-clearance-rulers]')`)
  await b.evaluate(`window.rulers=()=>{const root=document.querySelector('[data-window-clearance-rulers]');return {display:root.style.display,side:root.dataset.wallSide,rows:[...root.querySelectorAll('[data-measurement]')].filter(e=>e.style.display!=='none').map(e=>({kind:e.dataset.measurement,distance:Number(e.dataset.distance),target:e.dataset.target,text:e.textContent}))}};
    window.windowControls=(()=>{let c;roofWallScene().scene.traverse(o=>{if(o.isTransformControls&&o.object?.name==='model-transform-selection-window-1')c=o});return c})();true`)
  await b.wait(`rulers().display==='block'&&rulers().rows.length===4`)
  // Exercise the real pointer path too: callback-only tests miss event capture
  // and DOM overlay problems in the editor.
  const handle = await b.evaluate(`(()=>{const c=windowControls,s=roofWallScene();c.updateMatrixWorld(true);
    const meshes=[];c.traverse(o=>{if(o.isMesh&&o.name==='X'&&o.geometry?.attributes.position)meshes.push(o)});
    const mesh=meshes.find(o=>o.parent===c.children.find(g=>g.type==='TransformControlsGizmo')?.gizmo?.translate)??meshes[0];
    if(!mesh)throw Error('Missing X handle');mesh.geometry.computeBoundingBox();const p=mesh.geometry.boundingBox.getCenter(mesh.position.clone()).applyMatrix4(mesh.matrixWorld).project(s.camera),r=s.gl.domElement.getBoundingClientRect();
    return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`)
  await b.call('Input.dispatchMouseEvent', { type:'mouseMoved', ...handle })
  await b.call('Input.dispatchMouseEvent', { type:'mousePressed', ...handle, button:'left', buttons:1, clickCount:1 })
  await b.wait(`windowControls.dragging&&rulers().display==='block'&&rulers().rows.length===4`, 10000)
  await b.call('Input.dispatchMouseEvent', { type:'mouseMoved', x:handle.x-15, y:handle.y, button:'left', buttons:1 })
  report.pointerDrag = await b.evaluate('rulers()')
  await b.call('Input.dispatchMouseEvent', { type:'mouseMoved', ...handle, button:'left', buttons:1 })
  await b.call('Input.dispatchMouseEvent', { type:'mouseReleased', ...handle, button:'left', buttons:0, clickCount:1 })
  await b.wait(`!windowControls.dragging&&rulers().display==='block'`)
  await b.evaluate(`windowControls.dispatchEvent({type:'mouseDown',mode:'translate'});roofWallScene().invalidate()`)
  await b.wait(`rulers().display==='block'&&rulers().rows.length===4`)
  report.exterior = await b.evaluate('rulers()')
  assert.equal(report.exterior.side, '-1')
  assert.equal(report.exterior.rows.find(r => r.kind === 'right').target, 'opening')
  await b.evaluate(`windowControls.object.position.x+=.25;windowControls.object.position.y+=.1;windowControls.dispatchEvent({type:'objectChange'});roofWallScene().invalidate()`)
  await b.wait(`rulers().rows.find(r=>r.kind==='left').distance>${report.exterior.rows.find(r=>r.kind==='left').distance + .1}`)
  report.moved = await b.evaluate('rulers()')
  const value = (state, kind) => state.rows.find(row => row.kind === kind).distance
  assert.ok(Math.abs(value(report.moved, 'left') - value(report.exterior, 'left') - .25) < 1e-5)
  assert.ok(Math.abs(value(report.moved, 'right') - value(report.exterior, 'right') + .25) < 1e-5)
  assert.ok(Math.abs(value(report.moved, 'sill') - value(report.exterior, 'sill') - .1) < 1e-5)
  assert.ok(Math.abs(value(report.moved, 'head') - value(report.exterior, 'head') + .1) < 1e-5)
  const capture = async name => { const shot = await b.call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/${name}.png`, Buffer.from(shot.data, 'base64')) }
  await capture('exterior')
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(3,1.7,3.7);s.camera.lookAt(3,1.2,0);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await b.wait(`rulers().side==='1'&&rulers().rows.length===4`)
  report.interior = await b.evaluate('rulers()')
  await capture('interior')
  assert.ok(value(report.interior, 'left') < value(report.moved, 'left'), 'inside ruler ends at the return wall face')
  await b.evaluate(`windowControls.dispatchEvent({type:'mouseUp',mode:'translate'});roofWallScene().invalidate()`)
  await b.wait(`rulers().display==='block'`)
  const edit = async (kind, text, key = 'Enter') => {
    const point = await b.evaluate(`(()=>{const r=document.querySelector('[data-measurement="${kind}"] rect').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await b.call('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',buttons:1,clickCount:1})
    await b.call('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})
    await b.wait(`document.activeElement?.tagName==='INPUT'&&document.activeElement.getAttribute('aria-label')?.startsWith('Edit ')`)
    await b.call('Input.insertText', {text})
    await b.call('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:13})
    await b.call('Input.dispatchKeyEvent', {type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:13})
  }
  await edit('left', '1.234')
  await b.wait(`Math.abs(rulers().rows.find(r=>r.kind==='left').distance-1.234)<.00001`)
  await edit('head', '150 mm')
  await b.wait(`Math.abs(rulers().rows.find(r=>r.kind==='head').distance-.15)<.00001`)
  report.manualWindow = await b.evaluate('rulers()')
  console.log('Manual window clearances applied')
  const beforeCancel = await b.evaluate('JSON.stringify(regressionFloors)')
  await edit('left', '2.5', 'Escape')
  assert.equal(await b.evaluate('JSON.stringify(regressionFloors)'), beforeCancel)
  await edit('left', '999')
  await b.wait(`document.querySelector('input[aria-invalid="true"]')&&[...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('cross'))`)
  assert.equal(await b.evaluate('JSON.stringify(regressionFloors)'), beforeCancel)
  await b.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await b.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await b.evaluate('selectRegressionModel(null)')
  await b.wait(`!document.querySelector('[data-window-clearance-rulers]')`)
  // Patio doors share opening-edge measurements, but sit on the floor.
  report.patioDefinition = await b.evaluate(`(()=>{const {modelsById,syncWallOpenings}=regressionTools;
    const definition=modelsById.get('patio-doors')??[...modelsById.values()].find(d=>d.wallMount==='patio-door');
    if(!definition)throw Error('Missing patio door fixture');
    updateRegressionFloors(floors=>floors.map(f=>syncWallOpenings({...f,models:f.models.map(m=>m.id==='selection-window-1'?{...m,modelId:definition.id,position:{x:2.25,y:0},wallAttachment:{...m.wallAttachment,offset:2.25},scale:1,widthScale:1,wallOpeningBottom:undefined}:m)},modelsById)));
    return definition.id})()`)
  await b.evaluate(`selectRegressionModel('selection-window-1')`)
  await b.wait(`document.querySelector('[aria-label="Patio door clearances"]')&&rulers().rows.length===4`)
  report.patio = await b.evaluate('rulers()')
  assert.equal(value(report.patio, 'sill'), 0)
  assert.equal(report.patio.rows.find(r=>r.kind==='right').target, 'opening')
  await b.evaluate(`windowControls=(()=>{let c;roofWallScene().scene.traverse(o=>{if(o.isTransformControls&&o.object?.name==='model-transform-selection-window-1')c=o});return c})();windowControls.dispatchEvent({type:'mouseDown',mode:'translate'});windowControls.object.position.x+=.1;windowControls.dispatchEvent({type:'objectChange'});roofWallScene().invalidate()`)
  await b.wait(`rulers().rows.find(r=>r.kind==='left').distance>${value(report.patio, 'left') + .05}`)
  report.patioMoved = await b.evaluate('rulers()')
  assert.ok(Math.abs(value(report.patioMoved, 'left') - value(report.patio, 'left') - .1) < 1e-5)
  assert.equal(value(report.patioMoved, 'sill'), 0)
  await capture('patio-interior')
  await b.evaluate(`windowControls.dispatchEvent({type:'mouseUp',mode:'translate'})`)
  await edit('right', '100 cm')
  await b.wait(`Math.abs(rulers().rows.find(r=>r.kind==='right').distance-1)<.00001`)
  assert.equal((await b.evaluate('rulers()')).rows.find(r=>r.kind==='sill').distance, 0)
  assert.equal(await b.evaluate(`document.querySelector('[data-measurement="sill"]').getAttribute('role')`), null, 'patio thresholds stay floor-anchored')
  await b.evaluate('selectRegressionModel(null)')
  await b.wait(`!document.querySelector('[data-window-clearance-rulers]')`)
  assert.deepEqual(b.errors, [])
  console.log('PASS live window clearances, interior/exterior, drag completion and cleanup', JSON.stringify(report))
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors: b.errors }, null, 2)); b.close()
}
