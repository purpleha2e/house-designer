import {ShaderPass} from 'postprocessing'
import {Vector3} from 'three'
import {readWorldGrid,worldGridDefinitions} from './lumenWorldGrid.js'
import {skyVisibilityFragment} from '../../src/lumenSkyVisibility.ts'
import {lumenLookup} from '../../src/lumenViewportPass.ts'

const terms=['directSun','directSky','exteriorGround','firstBounce','laterBounce','outgoing']
const nextFrame=()=>new Promise(requestAnimationFrame)

export function bounceGridDefinitions(pass){
  const u=pass.displayMaterial.uniforms,p=u.surfacePoint.value.image.data,n=u.surfaceNormal.value.image.data
  const elevations=new Map()
  for(let i=0;i<p.length;i+=4){
    if(n[i+3]!==1||Math.abs(n[i+1])<.99||Math.abs(p[i+1])>.2||p[i+2]<1.2||p[i+2]>5.4||p[i]<-.85||p[i]>3.5)continue
    elevations.set(p[i+1],(elevations.get(p[i+1])??0)+1)
  }
  const y=[...elevations].sort((a,b)=>b[1]-a[1])[0]?.[0]
  if(y===undefined)throw Error('Timber floor cache height was not found')
  const floor={name:'floor',width:15,height:14,step:.30,normal:[0,1,0],points:[]}
  for(let i=0;i<floor.width*floor.height;i++)floor.points.push([-.8+(i%floor.width)*.30,y,5.25-Math.floor(i/floor.width)*.30])
  return [...worldGridDefinitions(),floor]
}

function compact(world){
  return world.grids.map(grid=>({...grid,points:grid.points.map(p=>{
    if(p.missing)return null
    const nearest=terms.map(key=>p.nearest[key]),values=terms.map(key=>p.interpolated[key])
    return {p:p.position,center:p.patch,n:p.normal,id:p.id,source:p.source,material:p.material,rho:p.albedo,
      nearest,values,groundStencil:p.weights,feedbackStencil:p.feedbackWeights}
  })}))
}

function changedShader(source,before,after){
  if(!source.includes(before))throw Error('Lighting audit splice no longer matches the active shader: '+before)
  return source.replace(before,after)
}

function ablationShader(shader){
  return changedShader(changedShader(changedShader(changedShader(shader,'uniform float overcast;','uniform float overcast;uniform vec4 auditTerms;'),
    'result.rgb=firstBounce+laterBounce;','result.rgb=auditTerms.z*firstBounce+auditTerms.w*laterBounce;'),
    'result.rgb+=exteriorBounce;','result.rgb+=auditTerms.y*exteriorBounce;'),
    'result.rgb+=directSky;','result.rgb+=auditTerms.x*directSky;')
    .replace('(sum+laterSum)/float(rays)+skyBase*groundDiffuse*daylight.z',
      '(auditTerms.z*sum+auditTerms.w*laterSum)/float(rays)+auditTerms.y*skyBase*groundDiffuse*daylight.z')
    .replace('result.rgb+=skyBase*daylight.x+groundRadiance*daylight.y;',
      'result.rgb+=auditTerms.x*(skyBase*daylight.x+groundRadiance*daylight.y);')
}

function targetedShader(shader){
  const source='vec3 start=p+n*.006;'
  // Two draws from the world-down cosine distribution and six from the
  // receiver cosine distribution. Reject the wrong side and use balance MIS.
  return changedShader(shader,'float r=j/float(sampleCount)','float r=(j-2.)/6.')
    .replace('vec3 ray=tangent*(sqrt(r)*cos(phi))+cross(n,tangent)*(sqrt(r)*sin(phi))+n*sqrt(1.-r);',
      'float radius=sqrt(max(0.,r));vec3 ray=tangent*(radius*cos(phi))+cross(n,tangent)*(radius*sin(phi))+n*sqrt(1.-max(0.,r));')
    .replace(source,`
    if(i%sampleCount<2){
      float q=(float(i%sampleCount)+.5)*.5;
      ray=vec3(sqrt(q)*cos(phi),-sqrt(1.-q),sqrt(q)*sin(phi));
    }
    float cosine=max(0.,dot(n,ray));
    if(cosine<=0.)continue;
    float mis=cosine/(.75*cosine+.25*max(0.,-ray.y));
    ${source}`).replaceAll('rho*outgoing/float(sampleCount)','rho*outgoing*mis/float(sampleCount)')
}

function groundShader(version){
  const fixed={clipReveals:version.startsWith('reveal'),elevated:null}
  if(version==='open')fixed.terrainSkySamples=0
  if(version==='fixed'||version==='sky16')fixed.fixedTerrainElevation=true
  if(version==='sky16')fixed.terrainSkySamples=16
  if(version.startsWith('reveal-budget'))fixed.elevated={
    columns:version==='reveal-budget-y'?3:4,rows:version==='reveal-budget-x'?3:4,skySamples:1,
  }
  return skyVisibilityFragment(lumenLookup,fixed)
}

export function prepareBounceStudy(s,audit){
  const renderer=s.gl,gl=renderer.getContext(),pass=audit.lumenPass()
  const u=pass.traceMaterial.uniforms,gridDefinitions=bounceGridDefinitions(pass)
  const original=Object.fromEntries(['skyVisibility','groundVisibility','surfaceBounceFront','surfaceBounceBack'].map(k=>[k,u[k].value]))
  const nativeMode=s.frameloop,targets=[],stages=[],materials=[]
  let firstAtlas,skyAtlas=pass.skyAtlas,ablation,initialMotion
  const position=s.camera.position.clone(),rotation=s.camera.quaternion.clone()
  const metadata={groundBounds:u.groundBounds.value.toArray(),groundY:u.groundY.value,groundDiffuse:u.groundDiffuse.value.toArray(),
    nearDirections:u.nearDirections.value,skyStrata:u.skyStrata.value,bounceRays:u.bounceRays.value,
    feedbackSamples:pass.surfaceBounceMaterial.uniforms.surfaceBounceSamples.value,
    openings:Array.from({length:u.openingCount.value},(_,i)=>({center:u.openingCenter.value[i].toArray(),axis:u.openingAxis.value[i].toArray(),
      transmission:u.openingTransmission.value[i]}))}
  for(const [i,opening] of metadata.openings.entries())opening.depth=u.openingDepth.value[i]
  const shell=()=>({...pass,skyAtlas})
  const invalidate=()=>{s.scene.userData.displayEffectRevision++;s.invalidate()}
  async function settle(){
    pass.resetHistory()
    for(let i=0;i<18;i++){invalidate();await nextFrame()}
  }
  const clone=(base,name,fragment,uniforms)=>{
    const material=base.clone()
    material.name=name
    material.fragmentShader=fragment
    material.uniforms={...base.uniforms,...uniforms}
    materials.push(material)
    return material
  }
  function redraw(material){
    return new ShaderPass(material)
  }
  async function warm(quad,target){
    const old=renderer.getRenderTarget()
    try{renderer.setRenderTarget(target);await renderer.compileAsync(quad.scene,quad.camera)}
    finally{renderer.setRenderTarget(old)}
  }
  async function drawAtlas(quad,target,stage){
    const savedTarget=renderer.getRenderTarget()
    const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[]
    const started=performance.now()
    try{
      target.scissorTest=true
      for(let row=0;row<target.height;row+=4){
        target.scissor.set(0,row,target.width,Math.min(4,target.height-row))
        const query=timer?gl.createQuery():null
        if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query)
        quad.render(renderer,audit.composer.inputBuffer,target)
        if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);queries.push(query)}
        if(row%16===0)await nextFrame()
      }
      target.scissorTest=false
      await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,new Uint16Array(4))
      const error=gl.getError()
      if(error)throw Error('WebGL error during '+stage+': '+error)
      const times=queries.filter(q=>gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))
        .map(q=>gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6)
      stages.push({stage,elapsedMs:performance.now()-started,gpuMs:times.length===queries.length&&timer&&!gl.getParameter(timer.GPU_DISJOINT_EXT)?times.reduce((a,b)=>a+b,0):null,
        maxTileGPU:times.length?Math.max(...times):null,timedTiles:times.length,tiles:queries.length})
    }finally{
      renderer.setRenderTarget(savedTarget)
      queries.forEach(q=>gl.deleteQuery(q))
    }
  }

  async function build(arm){
    s.setFrameloop('never')
    try{
      if(arm.ground){
        const original=pass.skyMaterial
        const material=clone(original,'AuditGround'+arm.ground,groundShader(arm.ground),{
          skyStrata:{value:arm.ground==='tiles6'?6:arm.ground==='reveal-extra'?4:original.uniforms.skyStrata.value},
        })
        skyAtlas=pass.skyAtlas.clone()
        const quad=redraw(material)
        await warm(quad,skyAtlas)
        await drawAtlas(quad,skyAtlas,'daylight')
      }
      const base=pass.surfaceBounceMaterial
      let fragment=arm.targeted?targetedShader(base.fragmentShader):base.fragmentShader
      if(arm.noGround)fragment=changedShader(fragment,'daylight.x+groundDiffuse*daylight.z','daylight.x')
      const material=clone(base,'AuditFeedback'+(arm.targeted?'Targeted':'Replay'),fragment,{
        skyVisibility:{value:skyAtlas.texture},groundVisibility:{value:skyAtlas.textures[1]},
        previousFront:{value:null},previousBack:{value:null},surfaceBounceOrder:{value:0},
        surfaceBounceSamples:{value:arm.samples},surfaceBouncePattern:{value:0},
      })
      const quad=redraw(material),f=material.uniforms
      for(let order=0;order<arm.sweeps;order++){
        const target=pass.surfaceBounceAtlases[0].clone(),prior=targets[order-1]??pass.surfaceBounceAtlases[1]
        targets.push(target)
        f.surfaceBounceOrder.value=order
        f.previousFront.value=prior.texture
        f.previousBack.value=prior.textures[1]
        if(order===0){firstAtlas=target;await warm(quad,target)}
        await drawAtlas(quad,target,'feedback-'+(order+1))
      }
      return {stages}
    }finally{s.setFrameloop(nativeMode)}
  }

  async function readWorld(order){
    const selected=order===undefined?pass.surfaceBounceAtlases:[firstAtlas,targets[order-1]]
    const grids=compact(await readWorldGrid(renderer,{...shell(),surfaceBounceAtlases:selected},gridDefinitions))
    return {grids,summary:grids.map(g=>({name:g.name,points:g.points.length,covered:g.points.filter(Boolean).length})),terms}
  }

  async function present(order){
    const target=targets[order-1]
    u.skyVisibility.value=skyAtlas.texture
    u.groundVisibility.value=skyAtlas.textures[1]
    u.surfaceBounceFront.value=target.texture
    u.surfaceBounceBack.value=target.textures[1]
    await settle()
    return true
  }

  async function ablate(term){
    if(!ablation){
      ablation=clone(pass.traceMaterial,'AuditLightingAblation',ablationShader(pass.traceMaterial.fragmentShader),{
        auditTerms:{value:[1,1,1,1]},
      })
      const quad=redraw(ablation),target=pass.bounce.clone()
      try{await warm(quad,target)}finally{target.dispose()}
      pass.trace.fullscreenMaterial=ablation
    }
    ablation.uniforms.auditTerms.value=['sky','ground','first','later'].map(t=>Number(t!==term))
    await settle()
    return true
  }

  async function restore(){
    pass.trace.fullscreenMaterial=pass.traceMaterial
    for(const [key,texture] of Object.entries(original))u[key].value=texture
    if(skyAtlas!==pass.skyAtlas)skyAtlas.dispose()
    skyAtlas=pass.skyAtlas
    targets.splice(0).forEach(t=>t.dispose())
    materials.splice(0).forEach(m=>m.dispose())
    ablation=undefined
    stages.length=0
    await settle()
    return true
  }

  async function move(name,offset,opposite){
    s.camera.position.copy(position)
    s.camera.position.z+=offset
    s.camera.quaternion.copy(rotation)
    if(name==='window'){s.camera.position.set(.46,1.46,3.58);s.camera.lookAt(new Vector3(-.9505,1.45,3.17))}
    if(opposite){s.camera.position.set(1.6,1.46,3.9);s.camera.lookAt(new Vector3(3.8,1.4,6.6))}
    s.camera.updateMatrixWorld(true)
    await settle()
    const read=(await readWorld()).grids
    initialMotion??=read
    let changed=0
    for(const [i,g] of read.entries())for(const [j,p] of g.points.entries()){
      if(JSON.stringify(p)!==JSON.stringify(initialMotion[i].points[j]))changed++
    }
    const status=s.scene.userData.lumenGI
    return {name,changed,patches:status.surfaces,builds:status.geometryBuilds,relights:status.relights,
      position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),history:pass.historyFrames}
  }
  return {metadata,readWorld,ablate,build,present,restore,move}
}
