import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {installRenderLoopPreload} from './renderLoopAuditProbe.mjs'
const b=await lightingBrowser(),report={}
try {
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})();window.wallState=()=>loopFind().state;window.wallProps=()=>{let found;const host=document.getElementById('root');const walk=f=>{if(!f)return;if(f.memoizedProps?.onAddWall)found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(host[Object.keys(host).find(k=>k.startsWith('__reactContainer$'))].stateNode.current);return found}`})
 await b.call('Page.navigate',{url:`http://localhost:${process.argv[2]??4173}/`})
 await b.wait(process.argv.includes('--during-startup')?`!!wallState()?.scene&&!!wallProps()?.onAddWall`:`wallState()?.scene.userData.progressiveStartup?.phase==='full'&&!wallState().scene.userData.shaderWarmupPending`)
 assert.equal(await b.evaluate('wallProps().floors.reduce((n,f)=>n+f.walls.length,0)'),0)
 await b.evaluate(`window.wallDrawAt=0;const s=wallState(),render=s.gl.renderBufferDirect.bind(s.gl);s.gl.renderBufferDirect=(...args)=>{const result=render(...args),target=s.gl.getRenderTarget();if(window.wallAt&&!wallDrawAt&&args[0]===s.camera&&(!target||target.width>8)){let wall=false;s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry===args[4].geometry)wall=true});if(wall)wallDrawAt=performance.now()}return result};window.wallAt=performance.now();wallProps().onAddWall({start:{x:0,y:0},end:{x:5,y:0}})`)
 await b.wait('!!wallDrawAt',30000)
 report.visibleMs=await b.evaluate('wallDrawAt-wallAt')
 console.log('First wall visible',report.visibleMs)
 await b.wait('!wallState().scene.userData.shaderWarmupPending&&!wallState().scene.userData.indirectScanPending',60000)
 report.readyMs=await b.evaluate('performance.now()-wallAt')
 console.log('First wall shading ready',report.readyMs)
 assert.ok(report.visibleMs<3000,'one wall appears without waiting for detailed shaders')
 assert.ok(report.readyMs<10000,'one wall finishes preparing promptly')
 assert.deepEqual(b.errors,[])
 console.log('PASS New project -> first wall')
} finally {
 report.state=await b.evaluate('({body:document.body.innerText,data:wallState()?.scene.userData})').catch(()=>null)
 report.errors=b.errors;writeFileSync('tmp/first-wall-latency.json',JSON.stringify(report,null,2));b.close()
}
