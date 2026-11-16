import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { installRenderLoopPreload } from './renderLoopAuditProbe.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const corners=[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]
const project={activeFloorId:'room',wallKind:'external',sunPosition:{azimuth:1,elevation:.08},floors:[{
  id:'room',name:'Indoor sky check',elevation:0,roomHeight:2.4,slabThickness:.2,ceilingMode:'open',models:[],rooms:[],roofs:[],
  walls:corners.map((start,i)=>({id:'wall-'+i,start,end:corners[(i+1)%4],kind:'external',thickness:.2,height:2.4,openings:[]})),
}]}
const b=await lightingBrowser()
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    (${installRenderLoopPreload.toString()})();${projectFileInputFixtureSource}
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(project))}],'sky-room.house.json')}];
    window.skyState=()=>loopFind().state;
    window.skyProps=predicate=>{const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));let found;const walk=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(host[key].stateNode.current);return found};
  `})
  await b.call('Page.navigate',{url:`http://localhost:${process.argv[2]??4173}/`})
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`,30000)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`)
  await b.wait(`skyState()?.scene.userData.getIndirectUniforms?.().hdGIFloorCount.value>0`,30000)
  const read=()=>b.evaluate(`(()=>{const s=skyState(),u=s.scene.userData.getIndirectUniforms(),lights={};s.scene.traverse(o=>{if(['ambient-fill','ambient-sky-fill'].includes(o.userData.houseDesignerRole))lights[o.userData.houseDesignerRole]=o.color.toArray()});return{lights,transport:u.hdSkyRadianceBase.value.toArray(),exterior:u.hdSkyDisplayRadianceBase.value.toArray(),tint:u.hdExteriorAmbientTint.value.toArray()}})()`)
  const ready=()=>b.wait(`!skyState().scene.userData.shaderWarmupPending&&skyState().scene.userData.getIndirectUniforms().hdSkyRadianceBase.value.x>0`,60000)
  await ready()
  const low=await read()
  assert.deepEqual(low.lights,{'ambient-fill':[1,1,1],'ambient-sky-fill':[1,1,1]})
  assert.ok(low.exterior[0]<.3&&low.exterior[2]>low.exterior[0])
  assert.ok(Math.abs(low.transport[0]-.65)<1e-6&&Math.abs(low.transport[2]-.82)<1e-6)
  await b.evaluate(`(()=>{const p=skyProps(p=>p?.onLightDirectionChange&&p.lightDirection);p.onLightDirectionChange({...p.lightDirection,elevation:1})})()`)
  await b.wait(`skyState().scene.userData.getIndirectUniforms().hdSkyDisplayRadianceBase.value.x>.6`,10000)
  await ready()
  const high=await read()
  assert.deepEqual(high.lights,low.lights)
  assert.deepEqual(high.transport,low.transport,'raising the sun cannot change the indoor sky budget')
  assert.ok(high.exterior[0]>low.exterior[0]*2,'exterior shadows retain their sun-height palette')
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await b.wait(`!!document.querySelector('[aria-label="Daylight sky"]')`)
  await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Daylight sky"]');e.value='overcast';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await b.wait(`skyState().scene.userData.getIndirectUniforms().hdSkyMode.value===2`,10000)
  await ready()
  const cloud=await read()
  assert.deepEqual(cloud.lights,low.lights)
  assert.deepEqual(cloud.transport,low.transport)
  assert.equal(cloud.exterior[0],cloud.exterior[1]);assert.equal(cloud.exterior[1],cloud.exterior[2])
  assert.deepEqual(b.errors,[])
  console.log('PASS actual room: neutral indoor fill, stable indoor transport, coloured exterior twilight and grey overcast shadows')
  console.log(JSON.stringify({low,high,cloud}))
} finally {b.close()}
