import { localAssetLightingBrowser } from '../tests/browser/localAssetLightingBrowser.mjs'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
const out='tmp/eave-preview-session';mkdirSync(out,{recursive:true})
const b=await localAssetLightingBrowser()
let last=0
try{
  await b.call('Page.navigate',{url:'http://localhost:4173/'})
  writeFileSync(out+'/ready.json',JSON.stringify({ready:true}))
  const end=Date.now()+20*60*1000
  while(Date.now()<end){
    if(existsSync(out+'/command.json')){
      const command=JSON.parse(readFileSync(out+'/command.json','utf8'))
      if(command.id>last){
        last=command.id
        if(command.close)break
        try{
          let value
          if(command.expression)value=await b.evaluate(command.expression)
          if(command.method)value=await b.call(command.method,command.params??{})
          if(command.screenshot){const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+command.screenshot+'.png',Buffer.from(shot.data,'base64'))}
          writeFileSync(out+'/result.json',JSON.stringify({id:last,value,errors:b.errors,assets:b.assetErrors},null,2))
        }catch(error){writeFileSync(out+'/result.json',JSON.stringify({id:last,error:String(error),errors:b.errors},null,2))}
      }
    }
    await new Promise(resolve=>setTimeout(resolve,200))
  }
}finally{b.close()}
