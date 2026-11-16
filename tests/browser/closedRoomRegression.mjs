import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
const warnings = []
const b = await lightingBrowser({onEvent:event=>{
  if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='warning')
    warnings.push(event.params.args.map(a=>a.value??a.description).join(' '))
}})
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(u,o)=>f(String(u).includes('/colin_house_v2.json')?'/tests/fixtures/closed-room-offset-joins.json':u,o)`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5187}/`})
  await b.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  await b.evaluate(`(async()=>{window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState})()`)
  const geometryOnly=process.argv.includes('--geometry')
  await b.wait(geometryOnly ? `editorState()?.scene.userData.progressiveStartup?.phase==='full' && !editorState()?.scene.userData.shaderWarmupPending` : `['ready','fallback'].includes(editorState()?.scene.userData.indirectLighting?.state)`,150000)
  const gi=await b.evaluate(`editorState().scene.userData.indirectLighting`)
  if(!geometryOnly){assert.equal(gi.state,'ready',gi.failureReason??gi.shaderError);assert.ok(gi.probes>0&&gi.completed===gi.total)}
  const coverage=await b.evaluate(`(async()=>{
    const {Raycaster,Vector3}=await import('/node_modules/.vite/deps/three.js');
    const {buildWallBodyPerimeters}=await import('/src/wallEngine/wallBodyPerimeter.ts');
    const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');
    let props;const visit=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)==='SkirtingBoards')props=f.memoizedProps;visit(f.child);visit(f.sibling)};
    visit(getEditorFiber());
    const {scene}=editorState(),meshes=[];scene.updateMatrixWorld(true);
    scene.traverse(o=>{if(o.userData.houseDesignerRole==='skirting')meshes.push(o)});
    const samples=[];
    for(const perimeter of buildWallBodyPerimeters(props.geometryContextWalls).perimeters)for(const ring of perimeter.holes){
      const area=ring.reduce((s,p,i)=>{const n=ring[(i+1)%ring.length];return s+p.x*n.y-n.x*p.y},0);
      for(let i=0;i<ring.length;i++){
        const a=ring[i],c=ring[(i+1)%ring.length],dx=c.x-a.x,dz=c.y-a.y,len=Math.hypot(dx,dz);
        const nx=-dz/len*Math.sign(area),nz=dx/len*Math.sign(area),count=Math.max(1,Math.ceil(len/.1));
        for(let j=0;j<count;j++){
          const t=(j+.5)/count,origin=new Vector3(a.x+dx*t+nx*.08,.045,a.y+dz*t+nz*.08);
          const hits=new Raycaster(origin,new Vector3(-nx,0,-nz),0,.079).intersectObjects(meshes,false);
          samples.push({edge:i,t,covered:hits.length>0});
        }
      }
    }
    return {meshes:meshes.length,samples,walls:props.geometryContextWalls};
  })()`)
  assert.equal(coverage.meshes,1,'all corner returns stay in the floor’s single skirting batch')
  assert.ok(coverage.samples.length>100)
  const gaps=coverage.samples.filter(s=>!s.covered)
  if(gaps.length) console.log(JSON.stringify({walls:coverage.walls,gaps:gaps.reduce((r,g)=>({...r,[g.edge]:(r[g.edge]??0)+1}),{})}))
  assert.equal(gaps.length,0,`skirting gaps: ${JSON.stringify(gaps.slice(0,8))}`)
  assert.deepEqual(b.errors,[])
  assert.ok(!warnings.some(w=>/GI.*unavailable|shader.*failed/i.test(w)))
  if(process.argv.includes('--inspect')){
    const detail=await b.evaluate(`(async()=>{
      const {Raycaster,Vector2}=await import('/tests/browser/rendererTestModules.ts');const s=editorState();
      s.camera.position.set(5.4,.23,8.3);s.camera.lookAt(5.4,.16,8.95);s.camera.updateMatrixWorld();
      return [280,285,290,295,300,305].map(x=>{const ray=new Raycaster();ray.setFromCamera(new Vector2(x/537*2-1,1-500/725*2),s.camera);
        return {x,hits:ray.intersectObjects(s.scene.children,true).filter(h=>h.object.isMesh).slice(0,4).map(h=>({point:h.point.toArray(),normal:h.face.normal.toArray(),role:h.object.userData.houseDesignerRole,face:h.faceIndex,materialIndex:h.face.materialIndex}))}});
    })()`)
    console.log(JSON.stringify({walls:coverage.walls,detail}))
  }
  if(!geometryOnly){
    await b.evaluate(`(()=>{const s=editorState();s.camera.position.set(5.4,.23,8.3);s.camera.lookAt(5.4,.16,8.95);s.controls?.target?.set(5.4,.16,8.95);s.controls?.update();s.invalidate()})()`)
    await b.evaluate('new Promise(r=>setTimeout(r,1200))')
    const clip=await b.evaluate(`(()=>{const r=editorState().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
    mkdirSync('tmp/closed-room-regression',{recursive:true})
    const screenshot=Buffer.from((await b.call('Page.captureScreenshot',{format:'png',clip})).data,'base64')
    writeFileSync('tmp/closed-room-regression/corner.png',screenshot)
    const {data,info}=await sharp(screenshot).raw().toBuffer({resolveWithObject:true})
    // Sample across the inside corner on the wall and skirting. The previous
    // classifier produced a bright exterior-lit stripe on otherwise dark faces.
    for(const row of [.414,.69])for(const channel of [0,1,2]){
      const values=[]
      for(let x=Math.round(info.width*.512);x<=Math.round(info.width*.578);x++)
        values.push(data[(Math.round(info.height*row)*info.width+x)*info.channels+channel])
      assert.ok(Math.max(...values)-Math.min(...values)<15,`indoor corner has an exterior-lit stripe at row ${row}`)
    }
  }
  console.log(`PASS closed unlit room: ${geometryOnly?'geometry only':`GI ready (${gi.probes} probes)`}, ${coverage.samples.length} skirting coverage samples`)
} finally {b.close()}
