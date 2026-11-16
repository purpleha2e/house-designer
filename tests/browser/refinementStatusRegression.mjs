import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/refinementStatus.html'})
 await b.wait('!!window.statusTest')
 const before=await b.evaluate('statusTest.parentRenders()')
 for(let i=0;i<20;i++)await b.evaluate(`statusTest.status.set('Refining ${i+1}%')`)
 await b.wait(`document.getElementById('root').textContent==='Refining 20%'`)
 assert.equal(await b.evaluate('statusTest.parentRenders()'),before,'Progress must not rerender the house host')
 assert.equal(await b.evaluate(`document.querySelector('#root span').title`),'Refining 20%')
 assert.deepEqual(b.errors,[]);console.log('20 progress updates; status refreshed; zero house-host rerenders')
}finally{b.close()}
