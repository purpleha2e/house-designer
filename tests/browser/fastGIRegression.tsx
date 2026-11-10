/* eslint-disable react-refresh/only-export-components -- Standalone experiment fixture. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, _roots, useFrame } from '@react-three/fiber'
import { ACESFilmicToneMapping, DataUtils, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { IndirectLighting } from '../../src/components/IndirectLighting'
import { getIndirectLightingUniforms } from '../../src/indirectLightingShader'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'
import { checkFastGITransport } from './fastGITransport'
import { checkFastGIFilter } from './fastGIFilter'

const floors=[{id:'test',elevation:0,height:3,rooms:[{signature:'test',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}]}]
// The production renderer owns priority 1; IndirectLighting schedules its probe
// captures at priority 2. Reproduce that ordering in this isolated fixture.
function RenderScene(){useFrame(({gl,scene,camera})=>gl.render(scene,camera),1);return null}
function Box({name,position,size,color='#dddddd'}:{name:string;position:[number,number,number];size:[number,number,number];color?:string}) {
  return <mesh name={name} position={position} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color}/></mesh>
}
function App(){
  const [revision,setRevision]=useState(0),[windowWidth,setWindowWidth]=useState(2),[red,setRed]=useState(true),[partition,setPartition]=useState(true),[tableX,setTableX]=useState(2)
  Object.assign(window,{fastGITest:{
    state:()=>[..._roots.values()][0]?.store.getState(),
    transport:()=>checkFastGITransport([..._roots.values()][0]!.store.getState().gl),
    filter:()=>checkFastGIFilter([..._roots.values()][0]!.store.getState().gl),
    edit:(kind:string)=>{if(kind==='window')setWindowWidth(v=>v===2?3:2);if(kind==='red')setRed(v=>!v);if(kind==='partition')setPartition(v=>!v);if(kind==='table')setTableX(v=>v===2?3:2);setRevision(v=>v+1)},
    async read(){
      const state=[..._roots.values()][0]?.store.getState();if(!state)throw Error('No scene')
      const engine=state.scene.userData.fastGI.engine;if(!engine||engine.stats.state!=='ready')throw Error('Not ready')
      const read=async(target:typeof engine.surfaces,index=0)=>{const data=new Uint16Array(target.width*target.height*4);await state.gl.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,data,undefined,index);return Float32Array.from(data,v=>DataUtils.fromHalfFloat(v))}
      const surface=await read(engine.surfaces),normal=await read(engine.surfaces,1),status=await read(engine.states[engine.bank]),light=await read(engine.lighting[engine.bank])
      const captureReceiver=await read(engine.captures,1),captureNormal=await read(engine.captures,2)
      const captureRadiance=await read(engine.captures)
      let occupied=0,observed=0,empty=0,unknown=0,dark=0,radiant=0,energy=0,redEnergy=0,greenEnergy=0,positive=0,negative=0
      const hemisphere=[0,0],allHemisphere=[0,0],sphere=new Vector3(4,1.5,3)
      let floorUnderTable=0,underside=0,darkUnderside=0
      for(let i=0;i<status.length;i+=4){if(status[i]>.5)occupied++;if(status[i+1]>.5)observed++;else if(status[i]<.5&&status[i+2]<.5)unknown++;if(status[i+2]>.5)empty++}
      for(let i=0;i<surface.length;i+=4)if(surface[i+3]>0){const energy=(surface[i]+surface[i+1]+surface[i+2])/surface[i+3];if(energy<.001)dark++;else radiant++}
      for(let i=0;i<light.length/4;i+=4){energy+=light[i]+light[i+1]+light[i+2];redEnergy+=light[i];greenEnergy+=light[i+1]}
      for(let i=0;i<normal.length;i+=4)if(normal[i+3]>.5){if(normal[i]>0)positive++;if(normal[i]<0)negative++}
      for(let y=0;y<engine.captures.height;y++)for(let x=0;x<engine.captures.width;x++){
        const i=(x+y*engine.captures.width)*4,p=new Vector3(captureReceiver[i],captureReceiver[i+1],captureReceiver[i+2])
        if(Math.abs(p.x-tableX)<.6&&Math.abs(p.z-3)<.6) {
          if(Math.abs(p.y)<.02&&captureNormal[i+1]>.9)floorUnderTable++
          if(Math.abs(p.y-.71)<.02&&captureNormal[i+1]<-.9){underside++;if(Math.max(...captureRadiance.slice(i,i+3))<.001)darkUnderside++}
        }
        if(Math.abs(p.distanceTo(sphere)-.55)>.17)continue
        const size=engine.captures.width/4,side=captureNormal[i]>0?0:1,view=Math.floor(x/size)+Math.floor(y/size)*4
        allHemisphere[side]++;if(view%2===0)hemisphere[side]++
      }
      const material=(state.scene.getObjectByName('floor') as Mesh).material as MeshStandardMaterial,uniforms=getIndirectLightingUniforms(material)
      return {stats:{...engine.stats},occupied,observed,empty,unknown,dark,radiant,energy,redEnergy,greenEnergy,positive,negative,hemisphere,allHemisphere,floorUnderTable,underside,darkUnderside,
        probe:{...state.scene.userData.indirectLighting},fastWeight:uniforms?.hdFastWeight.value,fieldProbes:state.scene.userData.indirectLighting?.probes}
    },
  }})
  return <><div style={{position:'fixed',top:8,left:8,zIndex:2,font:'14px sans-serif'}}>Opposing-view GI · open the console for houseDesignerFastGI
    {['window','red','partition','table'].map(kind=><button key={kind} onClick={()=>{(window as unknown as {fastGITest:{edit:(s:string)=>void}}).fastGITest.edit(kind)}}>{kind}</button>)}</div>
    <Canvas shadows gl={{preserveDrawingBuffer:true}} camera={{position:[7.2,2.4,5.4],fov:65}} style={{width:1000,height:750}}
      onCreated={({gl,camera})=>{gl.toneMapping=ACESFilmicToneMapping;camera.lookAt(3,1,2);installNonBlockingShaderDiagnostics(gl)}}>
      {/* Match the visible opening to the linear sky radiance used by GI. */}
      <color attach="background" args={[.65,.72,.82]}/>
      <directionalLight position={[-5,5,3]} intensity={5} castShadow userData={{houseDesignerRole:'sun-light'}}
        shadow-mapSize={[1024,1024]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-camera-far={30} shadow-normalBias={.01}/>
      <pointLight position={[6.8,1.5,2]} intensity={12} decay={2}/>
      <Box name="floor" position={[4,-.1,3]} size={[8.4,.2,6.4]}/>
      <Box name="ceiling" position={[4,3.1,3]} size={[8.4,.2,6.4]}/>
      <Box name="red-wall" position={[8,1.5,3]} size={[.2,3,6.2]} color={red?'#e62018':'#dddddd'}/>
      <Box name="north" position={[4,1.5,0]} size={[8.2,3,.2]}/>
      <Box name="south" position={[4,1.5,6]} size={[8.2,3,.2]}/>
      <Box name="west-sill" position={[0,.5,3]} size={[.2,1,6.2]}/>
      <Box name="west-header" position={[0,2.9,3]} size={[.2,.2,6.2]}/>
      <Box name="west-left" position={[0,1.9,(3-windowWidth*.5)*.5]} size={[.2,1.8,3-windowWidth*.5]}/>
      <Box name="west-right" position={[0,1.9,6-(3-windowWidth*.5)*.5]} size={[.2,1.8,3-windowWidth*.5]}/>
      <mesh name="model-floating-sphere" position={[4,1.5,3]} castShadow receiveShadow><sphereGeometry args={[.55,24,16]}/><meshStandardMaterial/></mesh>
      <Box name="model-table-top" position={[tableX,.8,3]} size={[1.8,.18,2]}/>
      <Box name="model-table-leg-a" position={[tableX-.7,.35,2.2]} size={[.15,.7,.15]}/>
      <Box name="model-table-leg-b" position={[tableX+.7,.35,3.8]} size={[.15,.7,.15]}/>
      {partition&&<Box name="partition" position={[5,1.5,1.2]} size={[.15,3,2.4]}/>}
      <IndirectLighting floors={floors} revision={String(revision)} enabled blocked={false} indoorFill={0} daylight />
      <RenderScene/>
    </Canvas></>
}
createRoot(document.getElementById('root')!).render(<App/> )
