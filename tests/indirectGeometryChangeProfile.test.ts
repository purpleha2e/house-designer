import assert from 'node:assert/strict'
import test from 'node:test'
import {Matrix4} from 'three'
import {profileIndirectGeometryChanges} from './indirectGeometryChangeProfile.ts'
import type {IndirectGeometrySnapshot} from '../src/indirectVisibility.ts'

test('exact geometry profile distinguishes reordering, movement, removal and duplicate instances',()=>{
 const part=(x=0):IndirectGeometrySnapshot[number]=>({position:new Float32Array([0,0,0,1,0,0,0,1,0]),stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:3}],matrices:[new Matrix4().makeTranslation(x,0,0).toArray()],structural:false})
 const original=[part(),part(2),part(4)], reordered=[original[2],original[0],original[1]]
 assert.equal(profileIndirectGeometryChanges(original,reordered).unchangedTriangleFraction,1)
 const moved=profileIndirectGeometryChanges(original,[part(),part(2),part(5)])
 assert.equal(moved.unchangedObjects,2);assert.equal(moved.removedOrChangedTriangles,1)
 const removed=profileIndirectGeometryChanges(original,[part(),part(2)])
 assert.equal(removed.unchangedObjects,2);assert.equal(removed.changedOrRemovedObjects,1)
 assert.equal(profileIndirectGeometryChanges([part(),part()],[part()]).unchangedObjects,1)
})
