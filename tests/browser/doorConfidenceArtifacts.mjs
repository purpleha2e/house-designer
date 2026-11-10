import {createServer} from 'node:http'
import {createWriteStream,mkdirSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
const directory='docs/door-confidence'
mkdirSync(directory,{recursive:true})
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5181')
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.end();return}
 const name=req.url.slice(1)
 if(req.method!=='POST'||!/^[a-z0-9_-]+\.(json|bin\.gz)$/.test(name)){res.statusCode=400;res.end();return}
 try{await pipeline(req,createWriteStream(`${directory}/${name}`));res.end('saved')}catch(e){res.statusCode=500;res.end(String(e))}
}).listen(9185,'127.0.0.1',()=>console.log('ARTIFACTS 9185'))
process.on('SIGINT',()=>server.close(()=>process.exit()))
