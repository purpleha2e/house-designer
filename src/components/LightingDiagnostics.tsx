/* eslint-disable react-hooks/immutability -- Display-only Three.js diagnostic resources. */
import {useEffect,useRef,useState} from 'react'
import {Html} from '@react-three/drei'
import {useFrame,useThree} from '@react-three/fiber'
import {Color,DataUtils,InstancedMesh,Matrix4,MeshBasicMaterial,SphereGeometry,Vector3} from 'three'
import {lightingDiagnosticsEnabled,lightingDiagnosticModes,type LightingDiagnosticMode} from '../lightingDiagnostics'
import type {IndirectField} from '../indirectLighting'
import {updateIndirectUniforms,type IndirectUniforms} from '../indirectLightingShader'
import {createPackedDiagnosticField} from '../lightingDiagnosticFields'
import {IndirectLightingProbes} from './IndirectLightingProbes'
import {IndirectLightingInspector} from './IndirectLightingInspector'
import {indirectSHIrradianceBasis} from '../indirectSH'

export type LightingDiagnosticSnapshot={field:IndirectField;display?:IndirectField;generation:number;ready:boolean;captured:ReadonlySet<number>;direct?:Uint16Array[];sky?:Uint16Array[]}
type SkyResult={field:IndirectField;dispose:()=>void}
export function LightingDiagnostics({uniforms,snapshot,buildSky}:{uniforms:IndirectUniforms;snapshot:()=>LightingDiagnosticSnapshot;buildSky:(cancelled:()=>boolean)=>Promise<SkyResult|undefined>}){
  const {scene,invalidate}=useThree()
  const [mode,setMode]=useState<LightingDiagnosticMode>('Final composite'),[probe,setProbe]=useState(0),[report,setReport]=useState<ReturnType<typeof inspect>|null>(null)
  const [message,setMessage]=useState(''),[performanceText,setPerformanceText]=useState('')
  const latest=useRef({snapshot,buildSky});useEffect(()=>{latest.current={snapshot,buildSky}},[snapshot,buildSky])
  const sky=useRef<SkyResult|undefined>(undefined),skyGeneration=useRef(-1),busy=useRef(false),version=useRef(0),lastRefresh=useRef(-Infinity)
  const packed=useRef<SkyResult|undefined>(undefined)
  const active=lightingDiagnosticsEnabled
  function inspect(){
    const s=latest.current.snapshot(),offset=probe*4,p=Array.from(s.field.positionData.subarray(offset,offset+3))
    const basis=indirectSHIrradianceBasis(new Vector3(0,1,0),s.field.shOrder),coefficientOffset=probe*s.field.coefficientCount
    const rgb=(coefficients?:Uint16Array[])=>coefficients?[0,1,2].map(c=>Math.max(0,basis.reduce((sum,value,k)=>sum+value*DataUtils.fromHalfFloat(coefficients[c][coefficientOffset+k]),0))):null
    return {index:probe,position:p,valid:s.field.positionData[offset+3]===1,captured:s.captured.has(probe),upwardIrradiance:rgb(s.field.coefficients),upwardSky:rgb(s.sky),influenceRadius:s.field.spacing*1.75,generation:s.generation}
  }
  useEffect(()=>{
    if(!active)return
    const api={setMode(next:LightingDiagnosticMode){if(!lightingDiagnosticModes.includes(next))throw Error('Unknown lighting diagnostic view');setMode(next)},
      inspectProbe(index:number){setProbe(Math.max(0,Math.min(3967,Math.floor(index))));return latest.current.snapshot().field.positionData.slice(index*4,index*4+4)},
      get mode(){return mode},snapshot:()=>latest.current.snapshot(),components:()=>({sky:sky.current?.field,packed:packed.current?.field}),report:()=>({probe:inspect(),performance:scene.userData.getLightingPerformance?.(),preview:scene.userData.fastGI?.engine?.performance.report()})}
    scene.userData.lightingDiagnostics=api;Object.assign(window,{houseDesignerLighting:api})
    return()=>{delete scene.userData.lightingDiagnostics;if((window as unknown as Record<string,unknown>).houseDesignerLighting===api)delete (window as unknown as Record<string,unknown>).houseDesignerLighting}
  })
  useEffect(()=>{
    if(!active)return
    uniforms.hdLightingDiagnostic.value=Math.min(6,lightingDiagnosticModes.indexOf(mode))
    scene.userData.lightingDiagnosticUnlit=mode==='World normals'||mode==='Albedo'
    if(mode==='Probe irradiance'||mode==='Probe visibility')uniforms.hdLightingDiagnostic.value=0
    scene.userData.liveLightRevision=(scene.userData.liveLightRevision??0)+1;invalidate()
  },[active,mode,uniforms,scene,invalidate])
  useFrame(()=>{
    if(!active)return
    const s=latest.current.snapshot()
    if(skyGeneration.current!==s.generation&&sky.current){sky.current.dispose();sky.current=undefined;packed.current?.dispose();packed.current=undefined;uniforms.hdDiagnosticSkyReady.value=0}
    if((mode==='Sky lighting only'||mode==='Indirect reflected only')&&s.ready&&s.sky&&skyGeneration.current!==s.generation&&!busy.current){
      busy.current=true;const id=++version.current,generation=s.generation;setMessage('Preparing the cached sky component; no probe captures are restarted.')
      void latest.current.buildSky(()=>version.current!==id||latest.current.snapshot().generation!==generation).then(async result=>{
        if(!result)return;if(version.current!==id||latest.current.snapshot().generation!==generation){result.dispose();return}
        const combined=await createPackedDiagnosticField(s.field,result.field,()=>version.current!==id||latest.current.snapshot().generation!==generation)
        if(!combined){result.dispose();return}
        sky.current?.dispose();sky.current=result;skyGeneration.current=generation;packed.current?.dispose();packed.current=combined
        uniforms.hdDiagnosticSkyVolume.value=result.field.volume.maps[0];uniforms.hdDiagnosticSkyFloor.value=result.field.floorLayer.texture;uniforms.hdDiagnosticSkyReady.value=1
        setMessage('Sky and reflected views use cached SH components; no probe captures.');scene.userData.liveLightRevision=(scene.userData.liveLightRevision??0)+1;invalidate()
      }).catch(error=>setMessage(String(error))).finally(()=>{busy.current=false})
    }
    const component=mode==='Sky lighting only'||mode==='Indirect reflected only'?packed.current?.field:undefined
    updateIndirectUniforms(uniforms,component??s.display??s.field);uniforms.hdGIUseVolume.value=1
    if(performance.now()-lastRefresh.current>500){lastRefresh.current=performance.now();setReport(inspect());const p=scene.userData.getLightingPerformance?.();setPerformanceText(p?`${(p.totalMs/1000).toFixed(1)} s · ${p.draws} passes · ${p.triangles.toLocaleString()} triangles · ${p.textures} textures`:'No probe measurement yet')}
  })
  useEffect(()=>()=>{version.current++;sky.current?.dispose();packed.current?.dispose();uniforms.hdLightingDiagnostic.value=0;uniforms.hdDiagnosticSkyReady.value=0;delete scene.userData.lightingDiagnosticUnlit},[uniforms,scene])
  if(!active)return null
  const save=()=>{const data=scene.userData.lightingDiagnostics?.report(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lighting-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const visibility=mode==='Probe visibility',probes=visibility||mode==='Probe irradiance'
  return <>
    {probes&&<IndirectLightingProbes snapshot={()=>{const s=snapshot();return {...s,completed:scene.userData.indirectLighting?.completed??0}}}/>}
    {visibility&&<ProbeInfluence snapshot={snapshot} selected={probe}/>}
    {visibility&&<IndirectLightingInspector enabled snapshot={()=>{const s=snapshot();return {...s,lights:[]}}}/>}
    <Html fullscreen style={{pointerEvents:'none'}} zIndexRange={[300,300]}><section aria-label="Lighting diagnostics" style={{pointerEvents:'auto',position:'absolute',right:12,top:12,width:310,padding:12,background:'#111e',color:'white',font:'12px sans-serif',borderRadius:6}}>
      <strong>Lighting diagnostics · developer</strong>
      <label style={{display:'block',margin:'8px 0'}}>View <select aria-label="Lighting diagnostic view" value={mode} onChange={e=>setMode(e.currentTarget.value as LightingDiagnosticMode)}>{lightingDiagnosticModes.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Probe <input aria-label="Probe index" type="number" min={0} max={3967} value={probe} onChange={e=>setProbe(Math.max(0,Math.min(3967,Number(e.currentTarget.value))))}/></label>
      {report&&<p>#{report.index} · {report.valid?'valid':'invalid / unused'} · {report.captured?'captured':'not captured'}<br/>Position {report.position.map(v=>v.toFixed(2)).join(', ')}<br/>Upward RGB E: {report.upwardIrradiance?.map(v=>v.toFixed(4)).join(', ')}<br/>Sky RGB E: {report.upwardSky?.map(v=>v.toFixed(4)).join(', ')??'not available for this cache'}</p>}
      <p>{performanceText}</p><p>{message}</p>
      <p>Values are linear scene-relative irradiance, before albedo/exposure, not lux. Cyan wire spheres show maximum support; red marks invalid probes. In visibility view click a surface for exact occlusion tests.</p>
      <button onClick={save}>Download measurements</button>
    </section></Html>
  </>
}
function ProbeInfluence({snapshot,selected}:{snapshot:()=>LightingDiagnosticSnapshot;selected:number}){
  const [resources]=useState(()=>{const geometry=new SphereGeometry(1,8,6),material=new MeshBasicMaterial({color:'white',wireframe:true,transparent:true,opacity:.2,depthWrite:false,depthTest:false}),mesh=new InstancedMesh(geometry,material,4096);mesh.userData.selectionDecoration=true;mesh.frustumCulled=false;mesh.raycast=()=>{};return {geometry,material,mesh,matrix:new Matrix4(),last:''}})
  useFrame(()=>{const s=snapshot(),key=`${s.generation}:${s.field.probes.length}:${selected}`;if(key===resources.last)return;resources.last=key
    let count=0;for(const p of s.field.probes.filter(p=>p.index===selected)){resources.matrix.makeScale(s.field.spacing*1.75,s.field.spacing*1.75,s.field.spacing*1.75);resources.matrix.setPosition(new Vector3().fromArray(s.field.positionData,p.index*4));resources.mesh.setMatrixAt(count,resources.matrix);resources.mesh.setColorAt(count++,new Color('#00cddd'))}
    for(let index=0;index<3968;index++){const p=s.field.positionData.subarray(index*4,index*4+4);if(p[3]||!p.slice(0,3).some(v=>v!==0))continue;resources.matrix.makeScale(.1,.1,.1);resources.matrix.setPosition(new Vector3().fromArray(p));resources.mesh.setMatrixAt(count,resources.matrix);resources.mesh.setColorAt(count++,new Color('#ff3322'))}
    resources.mesh.count=count;resources.mesh.instanceMatrix.needsUpdate=true;if(resources.mesh.instanceColor)resources.mesh.instanceColor.needsUpdate=true
  })
  useEffect(()=>()=>{resources.mesh.dispose();resources.geometry.dispose();resources.material.dispose()},[resources])
  return <primitive object={resources.mesh}/>
}
