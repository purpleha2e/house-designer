import test from 'node:test'
import assert from 'node:assert/strict'
import {lightingDiagnosticModes,lightingDiagnosticValue} from '../src/lightingDiagnostics.ts'

test('diagnostic view uniforms preserve existing IDs and expose full probe modes',()=>{
  assert.equal(lightingDiagnosticValue('Final composite'),0)
  assert.equal(lightingDiagnosticValue('Direct lighting only'),1)
  assert.equal(lightingDiagnosticValue('Indirect reflected only'),3)
  assert.equal(lightingDiagnosticValue('Matte white'),6)
  assert.equal(lightingDiagnosticValue('Probe irradiance'),0)
  assert.equal(lightingDiagnosticValue('Probe visibility'),0)
  assert.equal(lightingDiagnosticValue('Probe indirect only'),9)
  assert.equal(lightingDiagnosticValue('Indirect irradiance false colour'),10)
  assert.equal(new Set(lightingDiagnosticModes).size,lightingDiagnosticModes.length)
})
