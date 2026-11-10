import test from 'node:test'
import assert from 'node:assert/strict'
import {cacheShaderKeyTransform} from '../src/shaderKeyTransform.ts'

test('identical source and features reuse the exact transformation, without a growing history',()=>{
  let calls=0
  const key=cacheShaderKeyTransform((source,features)=>{calls++;return `${source}:${features}`})
  assert.equal(key('a','one'),'a:one');assert.equal(key('a','one'),'a:one');assert.equal(calls,1)
  assert.equal(key('b','one'),'b:one');assert.equal(key('a','one'),'a:one');assert.equal(calls,3)
  assert.equal(key('a','two'),'a:two');assert.equal(calls,4)
})

test('failed transforms never validate the new source or features',()=>{
  let fail=false,calls=0
  const key=cacheShaderKeyTransform((source,features)=>{calls++;if(fail)throw Error('transform failed');return source+features})
  assert.equal(key('a','1'),'a1');fail=true
  assert.throws(()=>key('a','2'),/transform failed/)
  fail=false;assert.equal(key('a','2'),'a2');assert.equal(calls,3)
})
