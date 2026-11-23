import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, type WebGLRenderer } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { INDIRECT_MAX_LOCAL_LIGHTS } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { applySpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms, resizeRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { createRoomLightMask } from '../src/roomLightMask.ts'
import { rendererShadowMode, rendererShadowSize } from '../src/rendererRecovery.ts'
import { lightingDiagnosticsEnabled } from '../src/lightingDiagnostics.ts'
import { ShaderLib, UniformsUtils } from 'three'

test('atlas display shaders omit legacy room ray tracing and survive repeated hook installation', () => {
  const texture=createRoomLightMaskTexture(createRoomLightMask([], {minX:0,minZ:0,size:4},4))
  const room=createRoomLightShaderUniforms(texture,undefined,true),material=new MeshStandardMaterial()
  applyRoomLightShader(material,room);applyRoomLightShader(material,room)
  const shader={uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms),vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
  material.onBeforeCompile(shader as never,{} as WebGLRenderer)
  assert.equal(shader.fragmentShader.split('float hdAtlasMissingVisibility()').length-1,1)
  assert.ok(!shader.fragmentShader.includes('hdRoomTriangleBlocks'))
  assert.ok(!shader.fragmentShader.includes('hdRoomLightFactor'))
  assert.ok(shader.fragmentShader.includes('hdLocalAtlasVisibility'))
  assert.equal(shader.uniforms.hdLocalShadowAtlasRequested,room.localShadowAtlas.hdLocalShadowAtlasRequested)
  material.dispose();texture.dispose()
})

test('cached lighting keys preserve custom identity and live features in canonical order',()=>{
  const field=createIndirectField([]),texture=createRoomLightMaskTexture(createRoomLightMask([], {minX:0,minZ:0,size:4},4))
  const uniforms=createIndirectUniforms(field),room=createRoomLightShaderUniforms(texture),material=new MeshStandardMaterial()
  let upstream='custom-source',reads=0
  material.customProgramCacheKey=()=>{reads++;return upstream}
  applyRoomLightShader(material,room);applySpecularOnlyImageBasedLighting(material);applyIndirectLightingShader(material,uniforms)
  const expected=()=>{
    const roomSuffix=`:house-designer-room-light-v29-${rendererShadowMode}-${rendererShadowSize}-capacity11`
    const key=upstream==='custom-source'?'custom-source':':other'
    const ibl='-house-designer-specular-ibl-v1'
    const suffix=':house-designer-indirect-grid-l'+uniforms.hdGISHOrder.value+'-v49-exterior-tint'+
      (uniforms.hdFastFeature.value?'-fast':'')+(lightingDiagnosticsEnabled?'-diagnostics':'')+
      (uniforms.hdGIContactMode.value>.5?'-contacts':'')+(uniforms.hdSunBounceFeature.value>.5?'-sunbounce':'')+
      (uniforms.hdLocalSunFeature.value>.5?'-local-sun':'')
    return key+roomSuffix+ibl+suffix
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

test('room visibility grows beyond eleven lights and keeps cloned shader keys aligned', () => {
  const texture=createRoomLightMaskTexture(createRoomLightMask([], {minX:0,minZ:0,size:4},4))
  const room=createRoomLightShaderUniforms(texture),material=new MeshStandardMaterial()
  applyRoomLightShader(material,room)
  const clone=material.clone();clone.onBeforeCompile=material.onBeforeCompile.bind(material)
  clone.customProgramCacheKey=material.customProgramCacheKey.bind(material);applyRoomLightShader(clone,room)
  const before=material.customProgramCacheKey(),binding=room.pointOcclusionIds
  assert.equal(resizeRoomLightShaderUniforms(room,28),true)
  assert.equal(room.pointOcclusionIds,binding,'shared uniform bindings survive resizing')
  room.pointOcclusionIds.value[25]=25;room.spotRoomIds.value[25]=7
  assert.equal(room.pointOcclusionIds.value[25],25)
  assert.equal(room.pointOcclusionIds.value[27],-1,'new slots have no occlusion source until assigned')
  assert.notEqual(material.customProgramCacheKey(),before)
  assert.equal(clone.customProgramCacheKey(),material.customProgramCacheKey())
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <lights_fragment_begin>'}
  clone.onBeforeCompile(shader as never,{} as WebGLRenderer)
  assert.match(shader.fragmentShader,/#define HD_ROOM_LIGHT_CAPACITY 28/)
  assert.equal(shader.fragmentShader.split('#define HD_ROOM_LIGHT_CAPACITY').length-1,1)
  assert.equal(resizeRoomLightShaderUniforms(room,28),false)
  assert.equal(resizeRoomLightShaderUniforms(room,8),true)
  assert.equal(material.customProgramCacheKey(),before)
  material.dispose();clone.dispose();texture.dispose()
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
