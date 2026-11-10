// Production preview + Vite for the saved project fixture:
// node tests/browser/springfieldSunUpdateRegression.mjs [preview-port] [fixture-port]
import assert from 'node:assert/strict'
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const b=await lightingBrowser(), port=process.argv[2]??4173, fixtures=process.argv[3]??5180
const output='tmp/springfield-sun-update', door=readdirSync('dist/assets').find(n=>/^interior_door_closed-.*\.glb$/.test(n))
mkdirSync(output,{recursive:true})
// Capture merging has a conservative unmerged fallback for mixed gpuType inputs.
const unexpected=()=>b.errors.filter(e=>!/^THREE\.BufferGeometryUtils: \.merge(Attributes|Geometries)\(\) failed/.test(e))
async function wait(expression,timeout=300000){
  const end=Date.now()+timeout
  while(!await b.evaluate(expression)){
    assert.deepEqual(unexpected(),[])
    if(Date.now()>end)throw Error('Timed out: '+expression+' '+JSON.stringify(await b.evaluate('perfScene().scene.userData.indirectLighting')))
    await new Promise(resolve=>setTimeout(resolve,100))
  }
}
try{
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.testRoots=[];
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount(){},onCommitFiberRoot(id,root){
      if(!testRoots.includes(root))testRoots.push(root);
      const visit=f=>{if(!f)return;const v=f.memoizedProps?.value;if(v?.getState){const s=v.getState();if(s?.scene&&s?.gl)window.perfScene=()=>v.getState()}visit(f.child);visit(f.sibling)};visit(root.current);
    }};
    window.getGIProps=()=>{let p;const visit=f=>{if(!f)return;if(f.memoizedProps?.cacheProjectKey!==undefined&&f.memoizedProps?.cacheSettings)p=f.memoizedProps;visit(f.child);visit(f.sibling)};testRoots.forEach(r=>visit(r.current));return p};
    // Make the saved-cache/sun-edit overlap deterministic without altering the scene.
    window.holdCache=false;window.heldCache=[];
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);this.codec=String(url).includes('indirectBufferCodec.worker')}
      set onmessage(handler){super.onmessage=event=>{if(this.codec&&window.holdCache)heldCache.push(()=>handler.call(this,event));else handler.call(this,event)}}
      get onmessage(){return super.onmessage}
    };
    const nativeFetch=fetch;
    window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url??String(input);
      return nativeFetch(url.includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')?'/assets/${door}':input,init)};
    window.confirm=()=>false;
    window.showOpenFilePicker=async()=>[{name:'springfield_14.json',getFile:async()=>new File([await(await fetch('http://127.0.0.1:${fixtures}/springfield_14.json')).text()],'springfield_14.json')}];
  `})
  const navigation=await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/`})
  assert.equal(navigation.errorText,undefined,'production preview must be reachable')
  await wait('!!window.perfScene?.()')
  await b.evaluate(`holdCache=true;document.querySelector('[aria-label="Project menu"]').click()`)
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await wait(`getGIProps()?.savedCache?.layout.probes.length===308&&perfScene().scene.userData.indirectLighting?.state==='loading'&&heldCache.length>0`)
  console.log('Springfield cache restoration held after Colin load')
  const before=await b.evaluate(`JSON.stringify(JSON.parse(getGIProps().revision).lightDirection)`)
  const pad=await b.evaluate(`(()=>{const r=document.querySelector('.light-gimbal-pad').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x:pad.x+20,y:pad.y,button:'left',clickCount:1})
  await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:pad.x-20,y:pad.y-25,button:'left',buttons:1})
  await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:pad.x-20,y:pad.y-25,button:'left',clickCount:1})
  await wait(`JSON.stringify(JSON.parse(getGIProps().revision).lightDirection)!==${JSON.stringify(before)}`)
  await b.evaluate(`window.giTrace=[];window.giTimer=setInterval(()=>{const g=perfScene().scene.userData.indirectLighting;giTrace.push({t:performance.now(),generation:g.generation,state:g.state,completed:g.completed,total:g.total,pending:g.pendingLighting,source:g.source})},500);holdCache=false;heldCache.splice(0).forEach(deliver=>deliver())`)
  await wait(`(()=>{const g=perfScene().scene.userData.indirectLighting;return g?.worker&&g.completed>0})()`)
  console.log('New sun bake advanced past the cached 308 probes')
  await wait(`(()=>{const g=perfScene().scene.userData.indirectLighting;return g?.worker&&g.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.saving&&g.completed===g.total})()`)
  const result=await b.evaluate(`({status:perfScene().scene.userData.indirectLighting,trace:giTrace})`)
  writeFileSync(output+'/result.json',JSON.stringify(result,null,2))
  assert.ok(result.status.capturedFaces>0)
  assert.equal(result.status.completed,result.status.total)
  assert.deepEqual(unexpected(),[])
  console.log('PASS',JSON.stringify({generation:result.status.generation,completed:result.status.completed,total:result.status.total,capturedFaces:result.status.capturedFaces}))
}finally{b.close()}
