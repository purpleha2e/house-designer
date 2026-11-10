import {PMREMGenerator,Vector3,WebGLRenderer} from 'three'
import {createDaylightSky} from '../../src/daylightSky'
const renderer=new WebGLRenderer(),sky=createDaylightSky(64),generator=new PMREMGenerator(renderer)
const data:Record<string,{width:number;height:number;base64:string}>={}
try{
  for(const name of ['clear','overcast','ground'] as const){
    sky.update(name==='overcast'?'overcast':'clear',name==='ground'?0:1,new Vector3().setScalar(name==='ground'?1:0))
    const target=generator.fromCubemap(sky.texture),pixels=new Uint16Array(target.width*target.height*4)
    await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels)
    const bytes=new Uint8Array(pixels.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
    data[name]={width:target.width,height:target.height,base64:btoa(binary)};target.dispose()
  }
  Object.assign(window,{bakedDaylightEnvironments:{data,glError:renderer.getContext().getError()}})
}finally{sky.dispose();generator.dispose();renderer.dispose()}
