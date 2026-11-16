import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
const b=await lightingBrowser()
try{await b.call('Page.navigate',{url:'http://127.0.0.1:5189/tests/browser/shaderCompileCost.html'});await b.wait('window.shaderCompileCostDone',180000);console.log(await b.evaluate('shaderCompileCost'));console.log(b.errors)}finally{b.close()}
