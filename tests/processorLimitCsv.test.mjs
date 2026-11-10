import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCsvLine,analyseProcessorEvents} from './analyseProcessorLimitCsv.mjs'

test('CSV reads quoted commas and escaped quotes without shifting processor fields',()=>{
  assert.deepEqual(parseCsvLine(' a, "b,c","d""e", 4 '),['a','b,c','d"e','4'])
})

test('only the verified BIOS cap event schema is interpreted; other versions remain counted',()=>{
  const row=(id,version)=>['Microsoft-Windows-Kernel-Processor-Power','Info',id,version,0,4,0,33,'0x2',4,5,6,'','','','',
    '134387364107085130',0,0,0,3,60].join(',')
  const result=analyseProcessorEvents([row(47,0),row(47,1),row(48,0)].join('\n'))
  assert.deepEqual(result.counts,{47:2,48:1})
  assert.deepEqual(result.biosCaps,[{utc:'2026-11-09T22:20:10.708Z',group:0,processor:3,cap:60}])
  assert.deepEqual(result.processors,['0:3']);assert.deepEqual(result.caps,[60])
})
