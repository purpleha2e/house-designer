import test from 'node:test'
import assert from 'node:assert/strict'
import {editorLightingDisplay,editorLightingOverrides} from '../src/editorViewLighting.ts'

test('Build has a deterministic readable baseline independent of legacy exposure/adaptation',()=>{
 assert.deepEqual(editorLightingDisplay('build',4,true),{exposure:.5,adapt:false})
 assert.deepEqual(editorLightingDisplay('build',-2,false),{exposure:.5,adapt:false})
 const fill=editorLightingOverrides('build')
 assert.equal(fill.ambientTerm,.16);assert.equal(fill.nightAmbientTerm,.16);assert.equal(fill.lightShadows,true)
 assert.ok(!('daylight' in fill)&&!('lights' in fill)&&!('diffuseProbeResolution' in fill),'view policy must not change authored light sources or probe capture quality')
})
test('Lighting preview removes editing fill; custom preserves authored controls',()=>{
 assert.equal(editorLightingOverrides('lighting').ambientTerm,0)
 assert.deepEqual(editorLightingDisplay('lighting',-2,false),{exposure:1,adapt:true})
 assert.deepEqual(editorLightingOverrides('custom'),{})
 assert.deepEqual(editorLightingDisplay('custom',1.75,false),{exposure:1.75,adapt:false})
 assert.deepEqual(editorLightingDisplay('custom',-1,true),{exposure:-1,adapt:true})
})
test('Brightness is bounded',()=>{
 assert.equal(editorLightingDisplay('build',0,false,50).exposure,1.5)
 assert.equal(editorLightingDisplay('lighting',0,false,-50).exposure,0)
})
