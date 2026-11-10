import {Data3DTexture,HalfFloatType,LinearFilter,NoColorSpace,RGBAFormat} from 'three'
import {softGIView} from './softGIView.ts'
export function localLightView(s:any){
 if(!new URLSearchParams(location.search).has('diagnostic-local-light'))throw Error('Diagnostic flag required')
 const view=softGIView(s),field=s.scene.userData.getLightingField(),uniform=s.scene.userData.getIndirectUniforms().hdGIFloorLayer,original=uniform.value
 let current:Data3DTexture|undefined
 return {...view,async setLocalMode(mode:string){
  if(!['baseline','conservative','masked','baseline-10cm','conservative-10cm','masked-10cm'].includes(mode))throw Error('Unknown diagnostic mode')
  const response=await fetch(`/docs/local-light/${mode}.rgba16f.gz`)
  if(!response.ok)throw Error('Missing candidate texture')
  const body=await(response.headers.get('Content-Encoding')==='gzip'?response.arrayBuffer():new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()),data=new Uint16Array(body)
  if(data.length!==field.floorLayer.data.length)throw Error('Candidate layout mismatch')
  if(mode==='baseline'&&!data.every((v,i)=>v===field.floorLayer.data[i]))throw Error('Frozen baseline mismatch')
  const texture=new Data3DTexture(data,field.floorLayer.n,field.floorLayer.height*4,field.floorLayer.n)
  texture.type=HalfFloatType;texture.format=RGBAFormat;texture.colorSpace=NoColorSpace;texture.minFilter=texture.magFilter=LinearFilter;texture.unpackAlignment=1;texture.needsUpdate=true
  const start=performance.now();s.gl.initTexture(texture);uniform.value=texture;current?.dispose();current=texture
  return{mode,uploadSubmissionMs:performance.now()-start,bytes:data.byteLength}
 },dispose(){uniform.value=original;current?.dispose();view.dispose()}}
}
