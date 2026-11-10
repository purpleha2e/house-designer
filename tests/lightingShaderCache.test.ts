import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, type WebGLRenderer } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { INDIRECT_MAX_LOCAL_LIGHTS } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { applySpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { createRoomLightMask } from '../src/roomLightMask.ts'
import { rendererShadowMode, rendererShadowSize } from '../src/rendererRecovery.ts'
import { lightingDiagnosticsEnabled } from '../src/lightingDiagnostics.ts'

test('cached lighting keys exactly preserve the prior transforms across live upstream and feature changes',()=>{
  const field=createIndirectField([]),texture=createRoomLightMaskTexture(createRoomLightMask([], {minX:0,minZ:0,size:4},4))
  const uniforms=createIndirectUniforms(field),room=createRoomLightShaderUniforms(texture),material=new MeshStandardMaterial()
  let upstream='custom-source',reads=0
  material.customProgramCacheKey=()=>{reads++;return upstream}
  applyRoomLightShader(material,room);applySpecularOnlyImageBasedLighting(material);applyIndirectLightingShader(material,uniforms)
  const expected=()=>{
    const roomSuffix=`:house-designer-room-light-v24-${rendererShadowMode}-${rendererShadowSize}`
    let key=/:house-designer-room-light-v\d+/.test(upstream)?
      upstream.replace(/:house-designer-room-light-v\d+(?:-(?:single|cascaded|off)(?:-\d+)?)?/g,roomSuffix):upstream+roomSuffix
    const ibl='-house-designer-specular-ibl-v1'
    if(!key.includes(ibl))key+=ibl
    const suffix=':house-designer-indirect-grid-l'+uniforms.hdGISHOrder.value+'-v44-display'+
      (uniforms.hdFastFeature.value?'-fast':'')+(lightingDiagnosticsEnabled?'-diagnostics':'')+
      (uniforms.hdGIContactMode.value>.5?'-contacts':'')+(uniforms.hdSunBounceFeature.value>.5?'-sunbounce':'')+
      (uniforms.hdLocalSunFeature.value>.5?'-local-sun':'')
    const marker=/:house-designer-indirect-grid-l1-v\d+-(capture|display)(-fast)?(-diagnostics)?(-contacts)?(-sunbounce)?(-local-sun)?/g
    return key.match(marker)?key.replace(marker,suffix):key+suffix
  }
  try{
    let calls=0
    for(const value of ['custom-source',':house-designer-room-light-v2:other:house-designer-indirect-grid-l1-v4-capture-fast',
      'custom-source']){
      upstream=value
      for(const fast of [0,1,0]){
        uniforms.hdFastFeature.value=fast;uniforms.hdGIContactMode.value=fast
        uniforms.hdSunBounceFeature.value=fast;uniforms.hdLocalSunFeature.value=fast
        for(let i=0;i<3;i++){assert.equal(material.customProgramCacheKey(),expected());calls++}
      }
    }
    assert.equal(reads,calls,'the current upstream key is still read on every request')
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',
      fragmentShader:'#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>'}
    material.onBeforeCompile(shader as never,{} as WebGLRenderer)
    assert.equal(shader.fragmentShader.split('float hdGIFloor(').length-1,1)
  }finally{material.dispose();texture.dispose();field.dispose()}
})

test('bake light indices cover every supported lamp beyond the realtime display pool', () => {
  const field=createIndirectField([]),uniforms=createIndirectUniforms(field)
  try {
    assert.equal(uniforms.hdGIPointIndices.value.length,INDIRECT_MAX_LOCAL_LIGHTS)
    assert.equal(uniforms.hdGISpotIndices.value.length,INDIRECT_MAX_LOCAL_LIGHTS)
    uniforms.hdGIPointIndices.value[16]=123
    uniforms.hdGISpotIndices.value[127]=456
    assert.equal(uniforms.hdGIPointIndices.value[16],123)
    assert.equal(uniforms.hdGISpotIndices.value[127],456)
  } finally {field.dispose()}
})

for (const order of ['room-first', 'indirect-first'] as const) {
  test(`fade clones reuse composed lighting programs when ${order}`, () => {
    const field = createIndirectField([])
    const texture = createRoomLightMaskTexture(createRoomLightMask([], { minX: 0, minZ: 0, size: 4 }, 4))
    const room = createRoomLightShaderUniforms(texture)
    const indirect = createIndirectUniforms(field)
    const original = new MeshStandardMaterial()
    original.customProgramCacheKey = () => 'wall'
    const patch = (material: MeshStandardMaterial) => {
      if (order === 'room-first') applyRoomLightShader(material, room)
      applySpecularOnlyImageBasedLighting(material)
      applyIndirectLightingShader(material, indirect)
      if (order === 'indirect-first') applyRoomLightShader(material, room)
    }
    patch(original)
    const expected = original.customProgramCacheKey()
    for (let i = 0; i < 3; i++) {
      const clone = original.clone()
      clone.onBeforeCompile = original.onBeforeCompile.bind(original)
      clone.customProgramCacheKey = original.customProgramCacheKey.bind(original)
      clone.transparent = true
      patch(clone)
      assert.equal(clone.customProgramCacheKey(), expected)
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>' }
      clone.onBeforeCompile(shader as never, {} as WebGLRenderer)
      assert.equal(shader.fragmentShader.split('float hdGIFloor(').length - 1, 1)
      assert.equal(shader.vertexShader.split('varying vec3 hdRoomLightWorldPosition;').length - 1, 1)
      clone.dispose()
    }
    original.dispose(); texture.dispose(); field.dispose()
  })
}
