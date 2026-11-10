import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/gi-next/fixtures';mkdirSync(out,{recursive:true})
try{await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5181}/tests/browser/giNextFixtures.html`});await b.wait('!!window.runNextFixtures');const results=await b.evaluate('runNextFixtures()');writeFileSync(`${out}/depth.json`,JSON.stringify(results,null,2));assert.deepEqual(b.errors,[]);console.log(JSON.stringify(results.map(({kind,size,falseVisible,falseOccluded,maxPixelCentreDepthError})=>({kind,size,falseVisible,falseOccluded,maxPixelCentreDepthError}))))}finally{b.close()}
