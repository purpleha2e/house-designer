import {DataUtils,PMREMGenerator,Vector3,WebGLRenderer} from 'three'
import {createDaylightSky} from '../../src/daylightSky'
import {daylightEnvironmentPixels} from '../../src/daylightEnvironmentPixels'
async function load(name:string){
  const response=await fetch(new URL(`../../src/assets/environments/daylight-${name}.bin.gz`,import.meta.url)),raw=await response.arrayBuffer(),header=new Uint8Array(raw)
  const bytes=header[0]===31&&header[1]===139?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():raw
  return new Uint16Array(bytes)
}
const [clear,overcast,ground]=await Promise.all([load('clear'),load('overcast'),load('ground')])
const gl=new WebGLRenderer(),sky=createDaylightSky(64),generator=new PMREMGenerator(gl)
try{
  const results=[]
  for(const mode of ['clear','overcast'] as const)for(const sun of [new Vector3(),new Vector3(.4,.3,.2),new Vector3(1.3,.8,.5)]){
    sky.update(mode,1,sun);const target=generator.fromCubemap(sky.texture),actual=new Uint16Array(target.width*target.height*4)
    await gl.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,actual)
    const began=performance.now(),combined=daylightEnvironmentPixels(mode==='clear'?clear:overcast,ground,sun),combineCpuMs=performance.now()-began
    let maxAbsoluteError=0,totalError=0,values=0
    for(let i=0;i<actual.length;i++)if(i%4!==3){const error=Math.abs(DataUtils.fromHalfFloat(actual[i])-DataUtils.fromHalfFloat(combined[i]));maxAbsoluteError=Math.max(maxAbsoluteError,error);totalError+=error;values++}
    results.push({mode,sun:sun.toArray(),maxAbsoluteError,meanAbsoluteError:totalError/values,combineCpuMs,values});target.dispose()
  }
  Object.assign(window,{daylightEnvironmentBasis:{results,glError:gl.getContext().getError()}})
}finally{generator.dispose();sky.dispose();gl.dispose()}
