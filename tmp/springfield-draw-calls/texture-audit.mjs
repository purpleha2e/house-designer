import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
const root='dist-viewer',house=JSON.parse(fs.readFileSync(path.join(root,'house.json'))),rows=[]
async function inspect(buffer,owner,file) {
  if(buffer.subarray(1,5).toString()==='KTX '){
    rows.push({owner,file,format:'KTX2',width:buffer.readUInt32LE(20),height:buffer.readUInt32LE(24),levels:buffer.readUInt32LE(40),bytes:buffer.length}); return
  }
  try{const m=await sharp(buffer).metadata();rows.push({owner,file,format:m.format,width:m.width,height:m.height,bytes:buffer.length})}catch(error){rows.push({owner,file,error:error.message})}
}
for(const m of house.materials)for(const [slot,url] of Object.entries(m.pbr))if(typeof url==='string'&&url.startsWith('./'))await inspect(fs.readFileSync(path.join(root,url)),m.productName,slot)
for(const f of fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.glb'))){
  const b=fs.readFileSync(path.join(root,f));let json,bin
  for(let p=12;p<b.length;){const size=b.readUInt32LE(p),type=b.readUInt32LE(p+4),chunk=b.subarray(p+8,p+8+size);if(type===0x4e4f534a)json=JSON.parse(chunk.toString());if(type===0x004e4942)bin=chunk;p+=8+size}
  const owner=house.project.modelDefinitions.find(m=>m.sourceUrl?.replaceAll('/','\\').endsWith(f))?.name??f
  for(const [i,img] of (json.images??[]).entries()){
    if(img.bufferView!==undefined){const v=json.bufferViews[img.bufferView];await inspect(bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),owner,img.name??`image ${i}`)}
    else if(img.uri?.startsWith('data:'))await inspect(Buffer.from(img.uri.split(',')[1],'base64'),owner,img.name??`image ${i}`)
    else if(img.uri)await inspect(fs.readFileSync(path.resolve(root,path.dirname(f),decodeURIComponent(img.uri))),owner,img.name??`image ${i}`)
  }
}
rows.sort((a,b)=>b.width*b.height-a.width*a.height)
fs.writeFileSync('tmp/springfield-draw-calls/textures.json',JSON.stringify(rows,null,2))
console.log(JSON.stringify(rows,null,2))
