import {Mesh,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'
import {measureKitchenFrames} from './kitchenFrameMeasurements'
import {getRoomLightUniforms} from '../../src/roomLightShader'

export async function measureRoomVisibilityExperiment(s:RootState,composer:EffectComposer){
  const materials=new Set<Material>();s.scene.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(getRoomLightUniforms(m))materials.add(m)})
  const originals=[...materials].map(m=>({m,hook:m.onBeforeCompile,key:m.customProgramCacheKey})),frame=s.frameloop
  let optimized=true
  const select=(next:boolean)=>{if(next===optimized)return;optimized=next;for(const {m}of originals)m.needsUpdate=true}
  for(const {m,hook,key}of originals){
    m.onBeforeCompile=(shader,renderer)=>{hook.call(m,shader,renderer);if(!optimized)shader.fragmentShader=shader.fragmentShader.replaceAll(/\/\* HD_ZERO_LIGHT_BEGIN \*\/[\s\S]*?\/\* HD_ZERO_LIGHT_END \*\//g,'')}
    m.customProgramCacheKey=()=>key.call(m)+':zero-light-experiment-'+optimized;m.needsUpdate=true
  }
  s.setFrameloop('never')
  const draw=()=>{s.gl.setRenderTarget(null);s.gl.autoClear=true;composer.render(1/60)}
  const read=()=>{const data=new Uint8Array(s.gl.domElement.width*s.gl.domElement.height*4),c=s.gl.getContext();draw();c.readPixels(0,0,s.gl.domElement.width,s.gl.domElement.height,c.RGBA,c.UNSIGNED_BYTE,data);return data}
  try{
    select(false);draw();draw();const baseline=read();select(true);draw();draw();const candidate=read()
    let different=0,maxDifference=0;for(let i=0;i<baseline.length;i++)if(baseline[i]!==candidate[i]){different++;maxDifference=Math.max(maxDifference,Math.abs(baseline[i]-candidate[i]))}
    const performance=await measureKitchenFrames(s,composer,{restore:()=>select(false),cases:[['skip zero-light visibility',()=>select(true)],['repeat zero-light visibility',()=>select(true)]]})
    return{pixels:{values:baseline.length,different,maxDifference},performance}
  }finally{for(const {m,hook,key}of originals){m.onBeforeCompile=hook;m.customProgramCacheKey=key;m.needsUpdate=true}s.setFrameloop(frame);s.invalidate()}
}
