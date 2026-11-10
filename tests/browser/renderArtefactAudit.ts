import { DataUtils, FloatType, HalfFloatType, Mesh, MeshStandardMaterial, Vector3, WebGLRenderTarget } from 'three'
import type { RootState } from '@react-three/fiber'
import type { EffectComposer } from 'postprocessing'
import { getEditorFiber } from './rendererTestModules'

export function createArtefactAudit(s: RootState) {
  let composer: EffectComposer | undefined
  const visit = (f: ReturnType<typeof getEditorFiber>) => { if (!f) return; if (f.ref?.current?.passes) composer=f.ref.current; visit(f.child); visit(f.sibling) }
  visit(getEditorFiber()); if (!composer) throw Error('Missing compositor')
  const c=composer, ao=c.passes.find(p=>'renderTransparency' in p)!, u=s.scene.userData.getIndirectUniforms()
  const field=s.scene.userData.getLightingField(), generation=s.scene.userData.indirectLighting.generation
  const coefficients=field.coefficients.map((a:Uint16Array)=>a.slice())
  s.setFrameloop('never'); s.internal.active=false
  const width=s.gl.domElement.width,height=s.gl.domElement.height
  const shadows: {shadow:{intensity:number};intensity:number}[]=[]
  s.scene.traverse(o=>{const shadow=Reflect.get(o,'shadow');if(shadow)shadows.push({shadow,intensity:shadow.intensity})})
  const originalStrength=u.hdGIProbeStrength.value, frames=new Map<string,Float32Array>()
  const mode={value:0}, originals=new Map<Mesh,Mesh['material']>(), metadata:unknown[]=[], diagnosticMaterials:MeshStandardMaterial[]=[]
  const target=new WebGLRenderTarget(width,height,{type:FloatType,depthBuffer:true})
  const check=()=>{if(field!==s.scene.userData.getLightingField()||generation!==s.scene.userData.indirectLighting.generation||!coefficients.every((a:Uint16Array,k:number)=>a.every((v,i)=>v===field.coefficients[k][i])))throw Error('Frozen GI changed')}
  const pixel=(data:Float32Array,x:number,y:number)=>Array.from(data.subarray(((height-1-y)*width+x)*4,((height-1-y)*width+x)*4+4))
  return {
    frames, width,height, metadata,
    camera(){return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),projection:s.camera.projectionMatrix.toArray(),width,height}},
    setCamera(position:number[],lookAt:number[]){s.camera.position.fromArray(position);s.camera.lookAt(new Vector3().fromArray(lookAt));s.camera.updateMatrixWorld(true)},
    async capture(name:string, variant:string){
      ao.enabled=variant==='A';u.hdGIProbeStrength.value=['D','E'].includes(variant)?0:originalStrength
      shadows.forEach(v=>v.shadow.intensity=['C','E'].includes(variant)?0:v.intensity)
      mode.value=variant==='F'?10:0
      const tone=c.passes.at(-1)!,render=tone.render
      let pixels:Promise<Uint16Array>|undefined
      tone.render=function(renderer,input,...args){if(input.texture.type!==HalfFloatType)throw Error('Unexpected HDR type');const data=new Uint16Array(input.width*input.height*4);pixels=renderer.readRenderTargetPixelsAsync(input,0,0,input.width,input.height,data).then(()=>data);return render.call(this,renderer,input,...args)}
      try{for(let i=0;i<3;i++){await new Promise(requestAnimationFrame);c.render(1/60)}if(!pixels)throw Error('Missing HDR');frames.set(name,Float32Array.from(await pixels,DataUtils.fromHalfFloat));check();return {name,variant,camera:this.camera()}}
      finally{tone.render=render;mode.value=0}
    },
    sample(name:string,points:{id:string;x:number;y:number}[]){const data=frames.get(name);if(!data)throw Error('No frame '+name);return points.map(p=>({...p,rgba:pixel(data,p.x,p.y)}))},
    async instrument(){
      let id=0
      s.scene.traverse(o=>{
        if(!(o instanceof Mesh)||o.userData.selectionDecoration)return
        const source=Array.isArray(o.material)?o.material:[o.material];originals.set(o,o.material)
        const meshId=++id
        metadata.push({id:meshId,meshId:o.id,uuid:o.uuid,name:o.name,role:o.userData.houseDesignerRole,materials:source.map(m=>({id:m.id,uuid:m.uuid,name:m.name}))})
        const copies=source.map((m,slot)=>{
          if(!(m instanceof MeshStandardMaterial))return m
          const copy=m.clone(),compile=m.onBeforeCompile,key=m.customProgramCacheKey()
          Object.assign(copy,{defaultAttributeValues:Reflect.get(m,'defaultAttributeValues')})
          copy.onBeforeCompile=(shader,renderer)=>{
            compile.call(m,shader,renderer)
            if(!shader.fragmentShader.includes('hdGIWorldPosition'))throw Error('GI hook absent: '+m.name)
            Object.assign(shader.uniforms,{auditMode:mode,auditId:{value:meshId},auditSlot:{value:slot}})
            shader.fragmentShader=shader.fragmentShader.replace('void main() {',`uniform float auditMode,auditId,auditSlot;vec3 auditGI=vec3(0.);\n#include <shadowmask_pars_fragment>\nvoid main() {`)
              .replace('irradiance = hdGICapture > .5', 'auditGI=hdGILight; irradiance = hdGICapture > .5')
              .replace('#include <opaque_fragment>',`
                if(auditMode>.5){
                  vec3 gn=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));
                  vec3 sn=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix));
                  vec3 p;float fr;float floorId=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,gn,hdGIFloorLayerReady,p,fr);
                  vec3 mean;float support=0.;if(floorId>=0.)hdGIVolumeSample(floorId,p,sn,fr,mean,support);
                  vec3 value=vec3(0.);
                  if(auditMode<1.5)value=vec3(auditId,auditSlot,0.);
                  else if(auditMode<2.5)value=hdGIWorldPosition;
                  else if(auditMode<3.5)value=gn;
                  else if(auditMode<4.5)value=reflectedLight.directDiffuse;
                  else if(auditMode<5.5)value=vec3(getShadowMask());
                  else if(auditMode<6.5)value=auditGI;
                  else if(auditMode<7.5)value=p;
                  else if(auditMode<8.5)value=hdGIReceiverWorldOffset;
                  else if(auditMode<9.5)value=vec3(floorId,fr,support);
                  else if(auditMode<10.5)value=vec3(.8);
                  else if(auditMode<11.5)value=reflectedLight.indirectDiffuse;
                  gl_FragColor=vec4(value,1.);return;
                }
                #include <opaque_fragment>`)
          }
          copy.customProgramCacheKey=()=>key+':artefact-measurement-v1';diagnosticMaterials.push(copy);return copy
        });o.material=Array.isArray(o.material)?copies:copies[0]
      })
      const previous=s.gl.getRenderTarget();try{s.gl.setRenderTarget(target);await s.gl.compileAsync(s.scene,s.camera)}finally{s.gl.setRenderTarget(previous)}
      return metadata
    },
    async measure(points:{id:string;x:number;y:number}[]){
      ao.enabled=false;u.hdGIProbeStrength.value=originalStrength;shadows.forEach(v=>v.shadow.intensity=v.intensity)
      const previous=s.gl.getRenderTarget(),auto=s.gl.autoClear,results:Record<string,unknown>={}
      try{for(const [name,n]of Object.entries({object:1,position:2,normal:3,directDiffuse:4,shadowVisibility:5,giIrradiance:6,samplePosition:7,explicitOffset:8,volumeSupport:9,indirectDiffuse:11})){
        mode.value=n;s.gl.autoClear=true;s.gl.setRenderTarget(target);s.gl.render(s.scene,s.camera)
        const data=new Float32Array(width*height*4);await s.gl.readRenderTargetPixelsAsync(target,0,0,width,height,data)
        results[name]=points.map(p=>({id:p.id,rgba:pixel(data,p.x,p.y)}))
      }check();return results}finally{mode.value=0;s.gl.autoClear=auto;s.gl.setRenderTarget(previous)}
    },
    restore(){for(const [mesh,material]of originals)mesh.material=material;diagnosticMaterials.forEach(m=>m.dispose());target.dispose();ao.enabled=true;u.hdGIProbeStrength.value=originalStrength;shadows.forEach(v=>v.shadow.intensity=v.intensity)},
  }
}
