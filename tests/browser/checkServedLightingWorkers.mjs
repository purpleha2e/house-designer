// HTTP and module initialization only; this does not create a WebGL renderer.
import {readFileSync,writeFileSync} from 'node:fs'
const html=readFileSync('dist/index.html','utf8'),asset=html.match(/src=.([^ ]+?\.js)/)[1]
const code=readFileSync('dist'+asset,'utf8')
const paths=new Set([...code.matchAll(/\/assets\/indirect(?:Lighting|BufferCodec)\.worker-[A-Za-z0-9_-]+\.js/g)].map(m=>m[0]))
const rows=[]
for(const path of paths){
  for(const host of ['127.0.0.1','localhost']){
    try{
      const response=await fetch('http://'+host+':4173'+path,{signal:AbortSignal.timeout(3000)})
      const body=await response.text()
      rows.push({host,path,status:response.status,type:response.headers.get('content-type'),length:body.length,start:body.slice(0,80)})
    }catch(error){rows.push({host,path,error:error.message})}
  }
}
writeFileSync('tmp/viewport-fps/worker-http.json',JSON.stringify(rows,null,2))
console.log(JSON.stringify(rows,null,2))
