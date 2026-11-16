import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { readModelMaterialNames } from '../../server/model-material-names.mjs'
import { lightingBrowser } from './lightingHarness.mjs'
import { installRenderLoopPreload } from './renderLoopAuditProbe.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'
import { projectDownloadFixtureSource } from './projectDownloadFixture.mjs'

const path='exports/junior-cabin-bed-spindles-left-hd.glb'
const names=await readModelMaterialNames(path)
assert.equal(names.length,6)
assert.ok(names.every(name=>name.startsWith('hd_')),'the example GLB must actually contain tagged materials')
const source='/hd-material-regression.glb', bytes=readFileSync(path).toString('base64')
const asset={assetKind:'model',id:'hd-bed',category:'Furniture',collection:'Test',manufacturer:{name:'Test',slug:'test'},
  metadata:{productName:'Tagged bed',objectType:'furniture'},files:[{fieldName:'model',url:source}],materialNames:names,
  inferredDimensions:{width:1.91,depth:1.143,height:1.14,minX:-.955,maxX:.955,minZ:-.425,maxZ:.718}}
const finish={assetKind:'material',id:'hd-red',category:'paint',collection:'Test',manufacturer:{name:'Test',slug:'test'},files:[],
  metadata:{productName:'Test red',baseColor:'#b42d35',roughness:'.65'}}
const project={activeFloorId:'hd-floor',wallKind:'external',surfaceAssignments:[],floors:[{
  id:'hd-floor',name:'Floor 0',elevation:0,roomHeight:2.4,slabThickness:.2,walls:[],rooms:[],roofs:[],
  models:['bed-a','bed-b'].map((id,i)=>({id,modelId:'portal-model-hd-bed',position:{x:i*3,y:0},rotation:0,scale:1})),
}]}
const b=await lightingBrowser()
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    (${installRenderLoopPreload.toString()})();${projectFileInputFixtureSource}${projectDownloadFixtureSource}
    window.confirm=message=>!message.startsWith('Save changes');
    window.hdState=()=>loopFind().state;
    window.hdProps=predicate=>{const host=document.getElementById('root');if(!host)return;const key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));if(!key)return;let found;const walk=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(host[key].stateNode.current);return found};
    window.hdProject=${JSON.stringify(project)};
    window.projectFileFixture=async()=>[{getFile:async()=>new File([JSON.stringify(hdProject)],'hd-slots.house.json')}];
    window.projectDownloadFixture=async()=>({createWritable:async()=>({write:async text=>{window.hdSaved=JSON.parse(text)},close:async()=>{}})});
    const originalFetch=fetch;window.fetch=(url,options)=>String(typeof url==='string'?url:url.url).includes('/hd-material-regression.glb')?Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)),{headers:{'Content-Type':'model/gltf-binary'}})):String(url)==='/api/portal/catalog'?Promise.resolve(new Response(JSON.stringify(${JSON.stringify({manufacturers:[{assets:[asset,finish]}]})}),{headers:{'Content-Type':'application/json'}})):originalFetch(url,options);
    window.hdColour=(id,name)=>{const root=hdState()?.scene.getObjectByName('model-transform-'+id);let colour;root?.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:o.material?[o.material]:[])){if(m.name===name)colour=m.color?.getHexString()}});return colour};
  `})
  await b.call('Page.navigate',{url:`http://localhost:${process.argv[2]??4173}/`})
  await b.wait(`!!hdProps(p=>p?.onOpenModelSelector)`)
  await b.evaluate(`hdProps(p=>p?.onOpenModelSelector).onOpenModelSelector('objects')`)
  await b.wait(`hdProps(p=>p?.onSelectModel&&p.models)?.models.some(m=>m.id==='portal-model-hd-bed')`)
  // Close the picker via its own callback; load placements against the real catalogue.
  await b.evaluate(`hdProps(p=>p?.onSelectModel&&p.models).onClose()`)
  const menu=async label=>{
    await b.evaluate(`if(!document.querySelector('.project-menu-dropdown'))document.querySelector('[aria-label="Project menu"]').click()`)
    await b.wait(`!![...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`)
    await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  }
  await menu('Load')
  await b.wait(`hdProps(p=>p?.onSelectModel&&p.onAddWall)?.floors[0]?.id==='hd-floor'`)
  await b.wait(`!!hdColour('bed-a','hd_frame')&&!!hdColour('bed-b','hd_frame')&&!hdState().scene.userData.shaderWarmupPending`,30000)
  console.log('Loaded both tagged models')
  const original=await b.evaluate(`({frame:hdColour('bed-a','hd_frame'),quilt:hdColour('bed-a','hd_quilt')})`)
  await b.evaluate(`hdProps(p=>p?.onSelectModel&&p.onAddWall).onSelectModel('bed-a')`)
  await b.wait(`!!document.querySelector('[aria-label="Frame material"]')`)
  assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.context-model-material dt')].map(n=>n.textContent)`),['Frame','Ladder','Drawer fronts','Mattress','Pillow','Quilt'])
  await b.evaluate(`document.querySelector('[aria-label="Frame material"]').click()`)
  await b.wait(`!!document.querySelector('[aria-label="Frame material chooser"][open]')`)
  await b.evaluate(`hdProps(p=>p?.onChoose&&p.label==='Frame').onChoose('portal-material-hd-red')`)
  await b.wait(`hdColour('bed-a','hd_frame')==='b42d35'&&!hdState().scene.userData.shaderWarmupPending`,60000)
  console.log('Applied the frame override')
  assert.equal(await b.evaluate(`hdColour('bed-b','hd_frame')`),original.frame,'a second instance keeps its original material')
  assert.equal(await b.evaluate(`hdColour('bed-a','hd_quilt')`),original.quilt,'other material slots stay unchanged')
  await menu('Save to device');await b.wait('!!window.hdSaved')
  console.log('Saved the house')
  const saved=await b.evaluate('hdSaved')
  assert.equal(saved.floors[0].models[0].materialOverrides.hd_frame,'portal-material-hd-red')
  assert.equal(saved.floors[0].models[1].materialOverrides,undefined)
  assert.equal(saved.modelDefinitions.find(m=>m.id==='portal-model-hd-bed').materialRegions.length,6)
  await b.evaluate('window.hdProject=hdSaved')
  await menu('New');await b.wait(`hdProps(p=>p?.onAddWall)?.floors[0]?.id!=='hd-floor'`)
  console.log('Created a new house')
  await menu('Load');await b.wait(`hdProps(p=>p?.onAddWall)?.floors[0]?.id==='hd-floor'`)
  await b.wait(`hdColour('bed-a','hd_frame')==='b42d35'&&!hdState().scene.userData.shaderWarmupPending`,90000)
  await b.evaluate(`hdProps(p=>p?.onSelectModel&&p.onAddWall).onSelectModel('bed-a')`)
  await b.wait(`!!document.querySelector('[aria-label="Frame material"]')`)
  await b.evaluate(`document.querySelector('[aria-label="Frame material"]').click()`)
  await b.wait(`!!document.querySelector('.context-material-reset')`)
  await b.evaluate(`document.querySelector('.context-material-reset').click()`)
  await b.wait(`hdColour('bed-a','hd_frame')===${JSON.stringify(original.frame)}&&!hdState().scene.userData.shaderWarmupPending`,60000)
  assert.deepEqual(b.errors,[])
  console.log('PASS hd_ discovery, six material controls, per-instance editing, saved-house reload and original-finish reset')
} finally { writeFileSync('tmp/hd-material-browser-state.json',JSON.stringify(await b.evaluate(`({body:document.body.innerText,models:hdProps(p=>p?.onAddWall)?.floors[0]?.models,data:hdState()?.scene.userData,objects:(()=>{const out=[];hdState()?.scene.traverse(o=>{if(o.name||o.isMesh)out.push({name:o.name,type:o.type,materials:(Array.isArray(o.material)?o.material:o.material?[o.material]:[]).map(m=>({name:m.name,colour:m.color?.getHexString()}))})});return out})()})`).catch(()=>null),null,2));b.close() }
