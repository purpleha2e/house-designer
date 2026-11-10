import {lightingBrowser} from './lightingHarness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const b=await lightingBrowser(),url='http://127.0.0.1:5181/tests/browser/roofWallRegression.html?lighting-startup&sky-preferences',results=[]
async function controls(){await b.wait(`!!document.querySelector('[aria-label="3D view menu"]')`,300000);await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`);await b.wait(`!!document.querySelector('[aria-label="Sky intensity"]')`)}
try{
 await b.call('Page.navigate',{url});await controls();assert.equal(await b.evaluate(`document.querySelector('[aria-label="Sky intensity"]').value`),'1')
 await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Sky intensity"]');e.value='0';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await b.wait('regressionSkyPreferences?.skyStrength===0');const saved=await b.evaluate('regressionSkyPreferences');results.push({kind:'saved without completed cache',preferences:saved});assert.equal(saved.ambientTerm,.3)
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.regressionSkyPreferences='+JSON.stringify(saved)});await b.call('Page.navigate',{url});await controls();assert.equal(await b.evaluate(`document.querySelector('[aria-label="Sky intensity"]').value`),'0');results.push({kind:'zero restored without GI cache',value:0})
 assert.deepEqual(b.errors,[]);fs.writeFileSync('docs/sky-intensity/preferences-browser-tests.json',JSON.stringify({results,errors:b.errors},null,2));console.log('PASS old project default and sky persistence before GI completion')
}finally{b.close()}
