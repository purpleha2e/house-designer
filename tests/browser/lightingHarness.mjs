import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

/** Isolated real WebGL browser, with bounded protocol requests and cleanup. */
export async function lightingBrowser(options={}) {
  const browser=spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0',
    '--disable-background-timer-throttling','--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check',
    '--window-size=1100,820',...(options.uncapped?['--disable-frame-rate-limit','--disable-gpu-vsync']:[]),`--user-data-dir=${createBrowserTestProfile('lighting-audit-')}`,'about:blank'],{windowsHide:true})
  let ws
  try {
    const endpoint=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),30000)
      browser.stderr.on('data',data=>{const m=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}})
      browser.once('error',error=>{clearTimeout(timer);reject(error)})
    })
    ws=new WebSocket(endpoint);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
    let id=0
    const pending=new Map(),errors=[],logs=[]
    ws.addEventListener('message',event=>{
      const m=JSON.parse(event.data),request=pending.get(m.id)
      options.onEvent?.(m)
      if(request){pending.delete(m.id);clearTimeout(request.timer);m.error?request.reject(Error(JSON.stringify(m.error))):request.resolve(m.result)}
      if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)
      if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '))
      if(m.method==='Log.entryAdded')logs.push(m.params.entry)
    })
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(Error(`${method} timed out`))},180000)
      pending.set(requestId,{resolve,reject,timer});ws.send(JSON.stringify({id:requestId,method,params,sessionId}))
    })
    const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
    const call=(method,params={})=>send(method,params,sessionId)
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
    await call('Runtime.enable');await call('Page.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true})
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`const NativeSocket=window.WebSocket;window.WebSocket=class extends NativeSocket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',event=>event.stopImmediatePropagation())}};`})
    return {call,browserCall:(method,params={})=>send(method,params),evaluate,errors,logs,async wait(expression,timeout=180000){
      const end=Date.now()+timeout
      while(!await evaluate(expression)){if(errors.length)throw Error(errors.join('\n'));if(Date.now()>end)throw Error(`Timed out: ${expression}`);await new Promise(r=>setTimeout(r,80))}
    },close(){for(const request of pending.values())clearTimeout(request.timer);ws.close();browser.kill()}}
  }catch(error){ws?.close();browser.kill();throw error}
}
