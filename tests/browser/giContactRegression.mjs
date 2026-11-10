import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/giContactRegression.html?giContacts=local`})
 await b.wait('!!window.contactRegression')
 const result=await b.evaluate('contactRegression');assert.deepEqual(b.errors,[]);writeFileSync('docs/colin-contact-fix/contact-shader-regression.json',JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result))
}finally{b.close()}
