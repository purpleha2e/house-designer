import fs from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/combinedSunShader.html'})
 await b.wait('!!window.combinedShaderResult')
 const result=await b.evaluate('combinedShaderResult')
 fs.writeFileSync('docs/combined-sun-preview/shader-pixels.json',JSON.stringify({...result,errors:b.errors},null,2))
 if(!result.ok||b.errors.length)throw Error(JSON.stringify(result)+'\n'+b.errors.join('\n'))
 console.log(JSON.stringify(result))
}finally{b.close()}
