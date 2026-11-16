import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const base='https://www.pitchr.me/house-designer/springfield/'
const localHtml=await readFile('dist-viewer/index.html')
const hash=data=>createHash('sha256').update(data).digest('hex')
const revision=hash(localHtml).slice(0,20)
const script=localHtml.toString().match(/src="(\.\/assets\/[^\"]+\.js)"/)[1]
const localScript=await readFile('dist-viewer/'+script.slice(2))
const snapshot=localScript.toString().match(/house\.[a-f0-9]{20}\.json/)[0]
const snapshotSize=(await readFile('dist-viewer/'+snapshot)).length
for(let attempt=0;attempt<40;attempt++){
 try{
  const response=await fetch(base+'?v='+revision,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)})
  const html=Buffer.from(await response.arrayBuffer())
  if(response.ok&&hash(html)===hash(localHtml)){
   const js=await fetch(new URL(script,base),{signal:AbortSignal.timeout(20000)})
   if(!js.ok||hash(Buffer.from(await js.arrayBuffer()))!==hash(localScript))throw Error('Published script does not match this tour build')
   const house=await fetch(new URL(snapshot,base),{method:'HEAD',headers:{'Accept-Encoding':'identity'},signal:AbortSignal.timeout(20000)})
   if(!house.ok||Number(house.headers.get('content-length'))!==snapshotSize)throw Error('House snapshot not yet fully deployed')
   const result={url:base,updateUrl:base+'?v='+revision,htmlStatus:response.status,scriptStatus:js.status,snapshotStatus:house.status,snapshot,snapshotBytes:snapshotSize,verifiedAt:new Date().toISOString()}
   await writeFile('tmp/publish-springfield/deployment.json',JSON.stringify(result,null,2))
   console.log(JSON.stringify(result,null,2));process.exit(0)
  }
  console.log(`Waiting for website deployment (${response.status}, attempt ${attempt+1})`)
 }catch(error){console.log(`Waiting for website deployment: ${error.message}`)}
 await new Promise(resolve=>setTimeout(resolve,15000))
}
throw Error('Website deployment has not become visible within ten minutes')
