import {parentPort} from 'node:worker_threads'
import {filterSoftGI} from './softGIFilter.ts'
let graph,original
parentPort.on('message',message=>{
 try{
  if(message.kind==='initialize'){graph=message.graph;original=message.original;parentPort.postMessage({kind:'ready'});return}
  if(message.original)original=message.original
  const result=filterSoftGI(original,graph,message.radius,'sh',message.bounds)
  parentPort.postMessage({kind:'result',id:message.id,...result},[result.output.buffer])
 }catch(error){parentPort.postMessage({kind:'error',id:message.id,error:String(error)})}
})
