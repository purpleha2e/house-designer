import fs from 'node:fs'
import path from 'node:path'
import {DataUtils} from 'three'
import {readGatherInput} from './localFinalGatherInput.mjs'

/** Stages existing reference texture readbacks on disk, not in a radiance atlas.
 * A bounded tile LRU avoids expanding ~761 MiB of image data into the process. */
export async function readFirstBounceInput(source,dir,cacheTiles=64){
  fs.mkdirSync(dir,{recursive:true});const descriptors=new Map(),files=[]
  const read=await readGatherInput(source,key=>!/^reference\.textures\.\d+\.pixels$/.test(key),(key,_descriptor,offset,chunk)=>{
    const match=/^reference\.textures\.(\d+)\.pixels$/.exec(key);if(!match)return
    const id=Number(match[1]);let fd=descriptors.get(id)
    if(fd===undefined){const file=path.join(dir,'reference-texture-'+id+'.rgba16f');fd=fs.openSync(file,'w+');descriptors.set(id,fd);files[id]=file}
    fs.writeSync(fd,chunk,0,chunk.length,offset)
  })
  for(const fd of descriptors.values())fs.closeSync(fd)
  const handles=new Map(),tiles=new Map(),tileSize=64,limit=cacheTiles,stats={reads:0,hits:0,bytesRead:0,cacheBytes:0,maximumCacheBytes:limit*tileSize*tileSize*8}
  const locate=(id,x,y)=>{
    const texture=read.data.reference.textures[id],tx=Math.floor(x/tileSize),ty=Math.floor(y/tileSize),key=id+':'+tx+':'+ty
    let tile=tiles.get(key)
    if(tile){tiles.delete(key);tiles.set(key,tile);stats.hits++}else{
      let fd=handles.get(id);if(fd===undefined){fd=fs.openSync(files[id],'r');handles.set(id,fd)}
      const width=Math.min(tileSize,texture.width-tx*tileSize),height=Math.min(tileSize,texture.height-ty*tileSize),buffer=Buffer.alloc(width*height*8)
      for(let row=0;row<height;row++){const count=fs.readSync(fd,buffer,row*width*8,width*8,((ty*tileSize+row)*texture.width+tx*tileSize)*8);if(count!==width*8)throw Error('Short texture read')}
      tile={width,buffer};tiles.set(key,tile);stats.reads++;stats.bytesRead+=buffer.length;stats.cacheBytes+=buffer.length
      while(tiles.size>limit){const first=tiles.keys().next().value;stats.cacheBytes-=tiles.get(first).buffer.length;tiles.delete(first)}
    }
    const offset=((y-ty*tileSize)*tile.width+x-tx*tileSize)*8;return{buffer:tile.buffer,offset}
  }
  const pixel=(id,x,y)=>{const p=locate(id,x,y);return[0,1,2,3].map(c=>DataUtils.fromHalfFloat(p.buffer.readUInt16LE(p.offset+c*2)))}
  const textures=read.data.reference.textures.map((texture,id)=>({width:texture.width,height:texture.height,colorSpace:'linear-srgb',pixel:(x,y)=>pixel(id,x,y)}))
  const referenceTextures=read.data.reference.textures.map((texture,id)=>({...texture,pixels:new Proxy({},{get(_target,key){if(key==='length')return texture.width*texture.height*4;const index=Number(key);if(!Number.isInteger(index))return undefined;const p=Math.floor(index/4),texel=locate(id,p%texture.width,Math.floor(p/texture.width));return texel.buffer.readUInt16LE(texel.offset+index%4*2)}})}))
  let closed=false
  return{...read,textures,referenceTextures,stats,close(){if(closed)return;closed=true;for(const fd of handles.values())fs.closeSync(fd);tiles.clear();for(const file of files)if(file&&fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(dir))fs.rmdirSync(dir)}}
}
