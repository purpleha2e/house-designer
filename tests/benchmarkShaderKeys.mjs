// CPU-only comparison of the exact previous key transforms against cached hooks.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {MeshStandardMaterial} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectUniforms,applyIndirectLightingShader} from '../src/indirectLightingShader.ts'
import {applyRoomLightShader,createRoomLightMaskTexture,createRoomLightShaderUniforms} from '../src/roomLightShader.ts'
import {createRoomLightMask} from '../src/roomLightMask.ts'
import {applySpecularOnlyImageBasedLighting} from '../src/materials/imageBasedLighting.ts'
import {rendererShadowMode,rendererShadowSize} from '../src/rendererRecovery.ts'
import {lightingDiagnosticsEnabled} from '../src/lightingDiagnostics.ts'
const field=createIndirectField([]),texture=createRoomLightMaskTexture(createRoomLightMask([],{minX:0,minZ:0,size:4},4))
const uniforms=createIndirectUniforms(field),material=new MeshStandardMaterial()
applyRoomLightShader(material,createRoomLightShaderUniforms(texture))
applySpecularOnlyImageBasedLighting(material);applyIndirectLightingShader(material,uniforms)
const reference=()=>{
  let key=material.onBeforeCompile.toString(),suffix=`:house-designer-room-light-v24-${rendererShadowMode}-${rendererShadowSize}`
  key=/:house-designer-room-light-v\d+/.test(key)?key.replace(/:house-designer-room-light-v\d+(?:-(?:single|cascaded|off)(?:-\d+)?)?/g,suffix):key+suffix
  suffix='-house-designer-specular-ibl-v1';if(!key.includes(suffix))key+=suffix
  suffix=':house-designer-indirect-grid-l'+uniforms.hdGISHOrder.value+'-v44-display'+(uniforms.hdFastFeature.value?'-fast':'')+
    (lightingDiagnosticsEnabled?'-diagnostics':'')+(uniforms.hdGIContactMode.value>.5?'-contacts':'')+
    (uniforms.hdSunBounceFeature.value>.5?'-sunbounce':'')+(uniforms.hdLocalSunFeature.value>.5?'-local-sun':'')
  const marker=/:house-designer-indirect-grid-l1-v\d+-(capture|display)(-fast)?(-diagnostics)?(-contacts)?(-sunbounce)?(-local-sun)?/g
  return key.match(marker)?key.replace(marker,suffix):key+suffix
}
const arms={reference,candidate:()=>material.customProgramCacheKey()},trials={reference:[],candidate:[]}
let checksum=0
try{
  assert.equal(arms.candidate(),arms.reference(),'byte-for-byte keys must match')
  for(const call of Object.values(arms))for(let i=0;i<1000;i++)checksum+=call().length
  const iterations=2000
  for(let i=0;i<8;i++)for(const name of i%2?['candidate','reference']:['reference','candidate']){
    const start=performance.now()
    for(let j=0;j<iterations;j++)checksum+=arms[name]().length
    trials[name].push((performance.now()-start)*1000/iterations)
  }
  const median=values=>[...values].sort((a,b)=>a-b).slice(3,5).reduce((a,b)=>a+b)/2
  const result={scope:'CPU key-construction microbenchmark; not whole-view FPS',keyCharacters:reference().length,
    referenceMicroseconds:median(trials.reference),candidateMicroseconds:median(trials.candidate),trials,checksum}
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}finally{material.dispose();texture.dispose();field.dispose()}
