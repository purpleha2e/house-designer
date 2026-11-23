import { FloatType, DataTexture, RGBAFormat, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Matrix4 } from 'three'
import { HouseDenoiser } from '../../src/lightingLab/houseDenoiser'
import { HouseReference } from '../../src/lightingLab/houseReference'
import type { HouseSnapshot } from '../../src/lightingLab/houseBridge'

try {
  let lastStage = ''
  const stage = (message: string) => { Object.assign(window, { denoiseStage: message }); if (message !== lastStage) console.log(message); lastStage = message }
  stage('initializing synthetic denoiser')
  const denoiser = new HouseDenoiser()
  await denoiser.initialize()
  const width=96,height=64,clean=new Float32Array(width*height*4),noisy=clean.slice(),albedo=clean.slice(),normal=clean.slice()
  let seed=123
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,base=(Math.floor(x/8)+Math.floor(y/8))%2?.7:.25
    const value=x>72?2.5:base
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const noise=(seed/4294967296-.5)*.4
    for(let c=0;c<3;c++){clean[i+c]=value;noisy[i+c]=Math.max(0,value+noise);albedo[i+c]=base}
    normal.set([.5,.5,1,1],i);clean[i+3]=noisy[i+3]=albedo[i+3]=1
  }
  stage('denoising synthetic image')
  const output=await denoiser.denoise(noisy,albedo,normal,width,height,()=>{})
  let rawError=0,cleanError=0,hdrSum=0,hdrCount=0
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    const i=(y*width+x)*4
    if(x<68){rawError+=(noisy[i]-clean[i])**2;cleanError+=(output[i]-clean[i])**2}
    if(x>80){hdrSum+=output[i];hdrCount++}
  }
  const noiseRatio=Math.sqrt(cleanError/rawError),hdrMean=hdrSum/hdrCount
  stage(`synthetic complete: noise ratio ${noiseRatio}, HDR ${hdrMean}`)
  const pending=denoiser.denoise(noisy,albedo,normal,width,height,()=>{})
  denoiser.dispose()
  const cancelled=await pending.then(()=>false,error=>error.name==='AbortError')

  const geometry=new PlaneGeometry(4,4).rotateX(-Math.PI/2)
  const map=new DataTexture(albedo,width,height,RGBAFormat,FloatType);map.needsUpdate=true
  const material=new MeshStandardMaterial({map,roughness:1})
  const camera=new PerspectiveCamera(45,1,.1,20);camera.position.set(0,2,3);camera.lookAt(0,0,0)
  const snapshot:HouseSnapshot={position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:45,
    finishes:[{colour:[1,1,1],emission:[0,0,0],map,alphaTest:0,side:0,referenceMaterial:material}],
    parts:[{position:Float32Array.from(geometry.attributes.position.array),normal:Float32Array.from(geometry.attributes.normal.array),uv:Float32Array.from(geometry.attributes.uv.array),index:Uint32Array.from(geometry.index!.array),ranges:[{start:0,count:6,material:0}],matrices:[new Matrix4().toArray()],structural:true}]}
  const statuses:string[]=[]
  const reference=new HouseReference(document.getElementById('host')!,snapshot,{daylight:true,lights:[],sunColour:[0,0,0],sunDirection:[0,1,0]},camera,1,{diffuse:false,samples:8,bounces:4,width:64,textureSize:128,denoise:true},message=>{statuses.push(message);stage(message)})
  Object.assign(window,{denoiseReference:reference})
  const saveBefore=reference.canSave
  await reference.start()
  const end=performance.now()+180000
  while(!reference.canSave){
    if(reference.stats().error)throw Error(reference.stats().error)
    if(performance.now()>end)throw Error('HQ lifecycle timeout')
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  const rawBefore=await reference.pixels(),finished=reference.stats()
  const cleanImage=reference.renderer.domElement.toDataURL()
  reference.showRaw(true);const rawImage=reference.renderer.domElement.toDataURL()
  reference.showRaw(false);const repeat=reference.renderer.domElement.toDataURL()
  const rawAfter=await reference.pixels()
  const rawUnchanged=rawBefore.values.every((v,i)=>v===rawAfter.values[i])
  reference.dispose();reference.renderer.forceContextLoss();geometry.dispose();material.dispose();map.dispose()
  Object.assign(window,{denoiseResult:{noiseRatio,hdrMean,cancelled,saveBefore,finished,rawUnchanged,repeatMatches:cleanImage===repeat,imagesDiffer:cleanImage!==rawImage,denoisingStatus:statuses.some(s=>s.includes('denoising'))}})
}catch(error){Object.assign(window,{denoiseFailure:String(error)})}
