import {filterSoftGI} from '../softGIFilter'
let graph:any,original:Uint16Array
self.onmessage=({data})=>{try{if(data.kind==='initialize'){graph=data.graph;original=data.original;self.postMessage({kind:'ready'});return}const result=filterSoftGI(original,graph,data.radius,'sh',data.bounds);self.postMessage({kind:'result',id:data.id,...result},{transfer:[result.output.buffer]})}catch(error){self.postMessage({kind:'error',error:String(error)})}}
