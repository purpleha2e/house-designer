import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
const browser=await lightingBrowser({onEvent:async event=>{
  if(event.method==='Fetch.requestPaused')await browser.call('Fetch.fulfillRequest',{requestId:event.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from('export function ThreeDView(){return null};export function StairContent(){return null};export function clearThreeDModelAssetCaches(){}').toString('base64')})
}})
try {
  await browser.call('Fetch.enable',{patterns:[{urlPattern:'*/src/components/ThreeDView.tsx*',requestStage:'Request'}]})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    ${process.argv.includes('--red') ? "const originalFetch=window.fetch;window.fetch=(u,o)=>String(u).includes('/colin_house_v2.json')?originalFetch('/red_house_5.json',o):originalFetch(u,o);" : ''}
    window.confirmations=[];window.confirm=m=>{confirmations.push(m);return false};
    window.alert=console.warn;
    window.showOpenFilePicker=async()=>[{name:'springfield_14.json',getFile:async()=>new File([await (await fetch('/springfield_14.json')).text()],'springfield_14.json')}];
  `})
  await browser.call('Debugger.enable')
  const source=await (await fetch('http://127.0.0.1:5187/src/App.tsx')).text()
  const line=source.split('\n').findIndex(l=>l.includes('if (serializeSavedProject(getCurrentSavedProject())'))
  if(line<0)throw Error('No dirty check found')
  await browser.call('Debugger.setBreakpointByUrl',{urlRegex:'/src/App.tsx',lineNumber:line,condition:`(()=>{
    const current=JSON.parse(serializeSavedProject(getCurrentSavedProject())),clean=JSON.parse(lastCleanProjectRef.current),diff=[];
    const walk=(a,b,path)=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],path+'.'+k)}else diff.push({path,current:a,clean:b})};walk(current,clean,'');window.projectDiff=diff;return false;
  })()`})
  await browser.call('Page.navigate',{url:'http://127.0.0.1:5187/'})
  await browser.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  await browser.evaluate('new Promise(resolve=>setTimeout(resolve,2000))')
  if(!process.argv.includes('--red'))await browser.evaluate(`(async()=>{const {registerStairModels,stairDefinition}=await import('/src/stairLibrary.ts');const {createStairDesign}=await import('/src/stairDesign.ts');registerStairModels([stairDefinition('personal-stairs','My stairs',createStairDesign())])})()`)
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
  await browser.wait('!!window.projectDiff')
  console.log(JSON.stringify(await browser.evaluate('({diff:projectDiff,confirmations})'),null,2))
}finally{browser.close()}
