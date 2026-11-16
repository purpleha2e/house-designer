import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { installRenderLoopPreload } from './renderLoopAuditProbe.mjs'

const b = await lightingBrowser()
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installRenderLoopPreload.toString()})()` })
  await b.call('Page.navigate', { url: 'http://localhost:4173/' })
  await b.wait(`loopFind().state?.internal.subscribers.some(s=>s.ref.current.toString().includes('KeyW'))`, 30000)
  const result = await b.evaluate(`(async()=>{
    const s=loopFind().state, canvas=s.gl.domElement;
    const sub=s.internal.subscribers.find(s=>s.ref.current.toString().includes('KeyW'));
    let original=sub.ref.current;const before=s.camera.position.clone();
    let delta=.2, frames=0, movedFrames=0, last=before.clone();
    const controlled=(state)=>{original(state,delta);if(s.camera.position.distanceTo(last)>.0001)movedFrames++;last.copy(s.camera.position);frames++};
    Object.defineProperty(sub.ref,'current',{get:()=>controlled,set:value=>{original=value},configurable:true});
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const key=(type,code)=>document.dispatchEvent(new KeyboardEvent(type,{code,key:code==='AltLeft'?'Alt':'w',bubbles:true}));
    try{
      canvas.focus(); await frame(); frames=movedFrames=0; key('keydown','KeyW');
      for(let i=0;i<6;i++)await frame();
      key('keyup','KeyW'); const walking={frames,movedFrames,distance:s.camera.position.distanceTo(before)};
      const stopped=s.camera.position.clone();await frame();
      const released=s.camera.position.distanceTo(stopped);
      // Emulate pointer lock in this isolated headless browser. Exercise the
      // real look event handler across the same slow controller frames.
      let locked=null;
      Object.defineProperty(document,'pointerLockElement',{get:()=>locked,configurable:true});
      canvas.requestPointerLock=()=>{locked=canvas;document.dispatchEvent(new Event('pointerlockchange'));return Promise.resolve()};
      document.exitPointerLock=()=>{locked=null;document.dispatchEvent(new Event('pointerlockchange'))};
      key('keydown','AltLeft');const orientation=s.camera.quaternion.clone();
      const move=()=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:8,movementY:0,bubbles:true}));
      move();for(let i=0;i<5;i++){await frame();move()}
      const look=orientation.angleTo(s.camera.quaternion);key('keyup','AltLeft');
      key('keydown','KeyW');delta=.8;const stalled=s.camera.position.clone();await frame();
      const stalledDistance=stalled.distanceTo(s.camera.position);delta=.2;await frame();
      const resumed=stalled.distanceTo(s.camera.position);key('keyup','KeyW');
      return{walking,released,look,stalledDistance,resumed};
    }finally{Object.defineProperty(sub.ref,'current',{value:original,writable:true,configurable:true});key('keyup','KeyW');key('keyup','AltLeft')}
  })()`)
  assert.ok(result.walking.distance > .1, JSON.stringify(result))
  assert.ok(result.walking.movedFrames > 5, JSON.stringify(result))
  assert.equal(result.released, 0)
  assert.ok(result.look > .01, JSON.stringify(result))
  assert.equal(result.stalledDistance, 0)
  assert.ok(result.resumed > 0)
  assert.deepEqual(b.errors, [])
  console.log('Slow-frame keyboard, mouse look, release and stall recovery passed:', JSON.stringify(result))
} finally { b.close() }
