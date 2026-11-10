import {DataTexture,FloatType,LinearFilter,Mesh,RGBAFormat,Vector3,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import {createIndirectVisibility} from '../../src/indirectVisibility.ts'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic.ts'
import {bakeSurface,directSurfaceSampler} from '../giNextSurface.ts'
import {snapshotReferenceScene} from './sceneReferenceSnapshot.ts'
import {captureDepth,depthVisible} from './giNextDepth.ts'
import {getEditorFiber} from './rendererTestModules.ts'

export function surfaceExperiment(s:RootState,known:any[]){
  const generation=s.scene.userData.indirectLighting.generation,field=s.scene.userData.getLightingField(),root=s.scene.getObjectByName('model-transform-96cca887-d5d4-4fef-a941-c3638911c06a')!
  const fakeAO:{object:typeof root;visible:boolean}[]=[];s.scene.traverse(o=>{if(String(o.userData.houseDesignerRole).startsWith('fake-ambient-occlusion')){fakeAO.push({object:o,visible:o.visible});o.visible=false}})
  const meshes:Mesh[]=[];root.traverse(o=>{if(o instanceof Mesh)meshes.push(o)});if(meshes.length!==1)throw Error('Sofa fixture hierarchy changed; inspect before testing')
  const mesh=meshes[0],visibility=createIndirectVisibility(s.scene),sample=directSurfaceSampler(field,visibility),unoccluded=directSurfaceSampler(field,visibility,'none'),baked=bakeSurface(mesh,sample),originalGeometry=mesh.geometry
  const texture=new DataTexture(baked.atlas,baked.size,baked.size,RGBAFormat,FloatType);texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true
  const mode={value:0},original=new Map<Material,{hook:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>()
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    const hook=material.onBeforeCompile,key=material.customProgramCacheKey;original.set(material,{hook,key})
    material.onBeforeCompile=(shader,renderer)=>{hook.call(material,shader,renderer);shader.uniforms.giNextMode=mode;shader.uniforms.giNextMap={value:texture}
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 giNextIrradiance;attribute vec2 giNextUV;varying vec3 nextIrradiance;varying vec2 nextUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nnextIrradiance=giNextIrradiance;nextUV=giNextUV;')
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float giNextMode;uniform sampler2D giNextMap;varying vec3 nextIrradiance;varying vec2 nextUV;')
      const marker='if (hdGICapture < .5) hdGILight *= hdGIProbeStrength * hdGIDisplayStrength;'
      if(!shader.fragmentShader.includes(marker))throw Error('Production irradiance replacement marker changed')
      shader.fragmentShader=shader.fragmentShader.replace(marker,'if(hdGICapture<.5&&giNextMode>.5)hdGILight=giNextMode<1.5?nextIrradiance:texture2D(giNextMap,nextUV).rgb;\n'+marker)
    };material.customProgramCacheKey=()=>key.call(material)+':gi-next-isolated-sofa';material.needsUpdate=true
  }
  mesh.geometry=baked.geometry
  if(!mesh.visible)throw Error('Sofa is batched; explicit batch isolation required before rendering')
  const displayed=(p:any)=>{const floor=Math.max(0,field.floors.findIndex((_:unknown,i:number)=>p.position[1]>=field.ranges[i].bottom&&p.position[1]<field.ranges[i].top)),n=new Vector3().fromArray(p.normal),gn=new Vector3().fromArray(p.geometricNormal),step=[field.bounds.size/(field.volume.n-1),(field.ranges[floor].top-field.ranges[floor].bottom)/11,field.bounds.size/(field.volume.n-1)],bias=.02+gn.toArray().reduce((sum,v,i)=>sum+Math.abs(v)*step[i],0)
    return sampleDisplayedIndirect(field,floor,new Vector3().fromArray(p.position).addScaledVector(gn,bias),n).rgb}
  const coverage=Array.from({length:baked.metadata.triangles},(_,face)=>{const receiver=baked.receiver(face,1/3,1/3),p={name:`face-${face}`,face,...receiver};return{...p,volume:displayed(p),...baked.at(face,p.position),direct:sample(p),unoccluded:unoccluded(p)}})
  const points=known.filter(p=>p.owner?.parents.includes(root.name)).map(p=>({...p,face:p.owner.faceIndex,volume:p.shaderIrradiance,...baked.at(p.owner.faceIndex,p.position),direct:sample(p),unoccluded:unoccluded(p)}))
  return{metadata:{...baked.metadata,mesh:mesh.name,geometryGeneration:generation,sourceVertexCount:originalGeometry.attributes.position.count,coverage:coverage.length,knownPoints:points.length,biasMetres:.0002,probeLimit:12,scope:'Snapshot prototype only. All-face centre coverage; vertex attributes and padded per-triangle lightmap; existing GI volume still built and rendered elsewhere.'},points,coverage,
    setMode(value:number){if(s.scene.userData.indirectLighting.generation!==generation)throw Error('Stale surface generation');mode.value=value
      // Frame benchmarks temporarily restore authored AO. Primary comparison
      // captures always start with AO disabled, including after a benchmark.
      const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;const composer=f.ref?.current;if(composer?.passes){const ao=composer.passes.find((p:any)=>'configuration'in p&&'aoRadius'in p.configuration);if(ao)ao.enabled=false}visit(f.child);visit(f.sibling)};visit(getEditorFiber())
    },
    async reference(){const snapshot=await snapshotReferenceScene(s);return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./giNextReference.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress){s.scene.userData.giNextReferenceProgress=e.data.progress;return}worker.terminate();e.data.ok?resolve({metadata:{triangles:snapshot.triangles,textureBytes:snapshot.textureBytes,snapshotMs:snapshot.snapshotMs},...e.data}):reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};const transfers=[snapshot.data.positions.buffer,snapshot.data.uvs.buffer,snapshot.data.materialIndices.buffer,...snapshot.data.textures.map(t=>t.pixels.buffer)] as ArrayBuffer[];worker.postMessage({scene:snapshot.data,points:coverage,samples:256},transfers)})},
    async depth(){
      // Include all face centres for coverage, plus exact physical seam samples.
      const receivers=[...points,...coverage],probeIndices=new Set<number>();for(const p of receivers)for(const link of p.direct.links)probeIndices.add(link.index)
      const probes=[...probeIndices].map(index=>({index,position:new Vector3().fromArray(field.positionData,index*4).toArray()})),rows=[]
      for(const size of [16,32,64,128]){
        const {cubes,metrics}=await captureDepth(s.gl,visibility,probes,size),classifications=[];let falseVisible=0,falseOccluded=0,visible=0,occluded=0
        const at=performance.now()
        for(const p of receivers){const target=new Vector3().fromArray(p.position).addScaledVector(new Vector3().fromArray(p.geometricNormal),.0002).toArray();for(const link of p.direct.links){const expected=!link.blocked,actual=depthVisible(cubes.get(link.index)!,target);if(expected)visible++;else occluded++;if(actual&&!expected)falseVisible++;if(!actual&&expected)falseOccluded++;if(p.owner)classifications.push({name:p.name,index:link.index,expected,actual})}}
        const classificationMs=performance.now()-at
        const graphAt=performance.now(),graph=[]
        for(const a of probes)for(const b of [...probes].filter(b=>b!==a).sort((b,c)=>new Vector3().fromArray(a.position).distanceToSquared(new Vector3().fromArray(b.position))-new Vector3().fromArray(a.position).distanceToSquared(new Vector3().fromArray(c.position))).slice(0,10)){
          const direction=new Vector3().fromArray(b.position).sub(new Vector3().fromArray(a.position)),distance=direction.length(),expected=!visibility.occluded(new Vector3().fromArray(a.position),direction.normalize(),distance-.0001,.0001),actual=depthVisible(cubes.get(a.index)!,b.position)&&depthVisible(cubes.get(b.index)!,a.position);graph.push({a:a.index,b:b.index,expected,actual})
        }
        rows.push({...metrics,classificationMs,visible,occluded,falseVisible,falseOccluded,classifications,graph:{scope:'Only the selected sofa-probe subgraph; ten nearest candidates and bidirectional depth check; not used as receiver visibility',edges:graph.length,buildAndReferenceMs:performance.now()-graphAt,falseVisible:graph.filter(e=>e.actual&&!e.expected).length,falseOccluded:graph.filter(e=>!e.actual&&e.expected).length}})
      }
      return rows
    },
    dispose(){mesh.geometry=originalGeometry;for(const [m,v]of original){m.onBeforeCompile=v.hook;m.customProgramCacheKey=v.key;m.needsUpdate=true}fakeAO.forEach(({object,visible})=>object.visible=visible);texture.dispose();baked.dispose();visibility.dispose()}}
}
