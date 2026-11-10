import assert from 'node:assert/strict'
import test from 'node:test'
import { isSelectionOnlyPublication } from '../src/selectionPublication.ts'

test('selection and fresh callbacks bypass authored publication delay', () => {
  const inputs={floors:[],surfaceAssignments:[],lightingResetRevision:1,selectedModelId:'a',selectedSurface:null,onSelectModel:()=>{}}
  assert.equal(isSelectionOnlyPublication(inputs,{...inputs,selectedModelId:'b',onSelectModel:()=>{}}),true)
  assert.equal(isSelectionOnlyPublication(inputs,{...inputs,selectedModelId:null,selectedSurface:{type:'wall-face'}}),true)
  const reference={get current(){throw Error('Publication must not read the live ref')}}
  assert.equal(isSelectionOnlyPublication({...inputs,reference},{...inputs,reference,selectedModelId:'b'}),true)
  for(const change of [{floors:[]},{surfaceAssignments:[]},{lightingResetRevision:2},{activeFloorId:'other'},{showAllFloors:true},{isWallGeometryPending:true},{sceneRevision:2}]) {
    assert.equal(isSelectionOnlyPublication(inputs,{...inputs,...change}),false)
  }
})
