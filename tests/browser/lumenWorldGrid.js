import {DataUtils} from 'three'

const shifts=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const rgb=(data,index)=>Array.from(data.subarray(index*4,index*4+3))
const dotRgb=(a,b)=>a.map((v,i)=>v*b[i])
const scale=(a,value)=>a.map(v=>v*value)
const add=(a,b)=>a.map((v,i)=>v+b[i])
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x))

export function worldGridDefinitions(){
  const wallsY=[.17,2.27],left=-.9505123496,ceiling=2.38
  const planes=[
    ['left',[left,0,0],[1,0,0],2,[1.15,5.35],1,wallsY,.10],
    ['back',[0,0,1],[0,0,1],0,[-.80,3.50],1,wallsY,.10],
    ['ceiling',[0,ceiling,0],[0,-1,0],0,[-.80,3.50],2,[1.15,5.35],.10],
    ['left-fine',[left,0,0],[1,0,0],2,[1.15,2.15],1,[.55,2.15],.05],
    ['ceiling-fine',[0,ceiling,0],[0,-1,0],0,[.65,2.75],2,[1.25,2.05],.05],
  ]
  return planes.map(([name,base,normal,u,ur,v,vr,step])=>{
    const width=Math.round((ur[1]-ur[0])/step)+1,height=Math.round((vr[1]-vr[0])/step)+1
    return {name,width,height,step,normal,points:Array.from({length:width*height},(_,i)=>{
      const point=base.slice();point[u]=ur[0]+(i%width)*step;point[v]=vr[1]-Math.floor(i/width)*step;return point
    })}
  })
}

// Read each atlas attachment once. The world grid uses the same receiver and
// aperture stencil tests as the shader and does not read any screen texture.
export async function readWorldGrid(renderer,pass,grids){
  const u=pass.displayMaterial.uniforms
  const read=async(target,attachment=0)=>{
    const data=new Uint16Array(target.width*target.height*4)
    await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,data,undefined,attachment)
    return Float32Array.from(data,DataUtils.fromHalfFloat)
  }
  const [sky,ground,sun,first,firstBack,last,lastBack]=await Promise.all([
    read(pass.skyAtlas),read(pass.skyAtlas,1),read(pass.sunAtlas),...pass.surfaceBounceAtlases.flatMap(t=>[read(t),read(t,1)]),
  ])
  const {data:cells,width:nx,height:ny,depth:nz}=u.cells.value.image
  const pos=u.surfacePoint.value.image.data,norm=u.surfaceNormal.value.image.data,rho=u.surfaceAlbedo.value.image.data
  const low=u.supportLo.value.image.data,high=u.supportHi.value.image.data
  const origin=u.gridOrigin.value.toArray(),step=u.spacing.value,limit=u.patchLimit.value
  const skyBase=u.skyBase.value.toArray(),lower=u.groundRadiance.value.toArray(),groundAlbedo=u.groundDiffuse.value.toArray(),sunGain=u.sunGain.value.toArray()
  const coarse=p=>p.map((v,i)=>(v-origin[i])/step)
  const cell=c=>c.some((v,i)=>v<0||v>=[nx,ny,nz][i])?-1:cells[c[0]+nx*(c[1]+ny*c[2])]-1
  const each=(c,visit)=>{
    for(let index=cell(c),i=0;i<limit&&index>=0;i++,index=Math.round(rho[index*4+3])-1){if(visit(index))return index}
    return -1
  }
  const contains=(index,delta,tol)=>delta.every((x,c)=>x>=(low[index*4+c]/127.5-1)*step-tol&&x<=(high[index*4+c]/127.5-1)*step+tol)
  const source=index=>low[index*4+3]+256*high[index*4+3]
  const receiver=(p,n)=>{
    const c=coarse(p).map(Math.floor);let found=-1,best=1.7
    for(const [j,shift] of shifts.entries()){
      const exact=each(c.map((v,i)=>v+shift[i]),index=>{
        const sn=rgb(norm,index),delta=p.map((v,i)=>v-pos[index*4+i]),alignment=Math.abs(dot(n,sn)),plane=Math.abs(dot(delta,sn))
        if(alignment<.85||plane>.016||!contains(index,delta,.008))return false
        if(j===0&&alignment>.99&&plane<.0015)return true
        const score=dot(delta,delta)*.1/(step*step)+9*plane/step+3*(1-alignment)
        if(score<best){best=score;found=index}
        return false
      })
      if(exact>=0)return exact
    }
    return found
  }
  const stencil=(index,p,n,requireSupport=true)=>{
    const axis=n.findIndex(x=>Math.abs(x)>.995),weights=[[index,1]]
    if(axis<0)return weights
    const a=(axis+1)%3,b=(axis+2)%3
    if(requireSupport&&Math.min(high[index*4+a]-low[index*4+a],high[index*4+b]-low[index*4+b])/255<.4)return weights
    const center=rgb(pos,index),c=coarse(center).map(Math.floor),point=coarse(p)
    const f=[a,b].map(i=>clamp(point[i]-c[i]-.5,-.5,.5))
    weights.length=0
    for(const x of [0,1])for(const y of [0,1]){
      const w=(x?Math.abs(f[0]):1-Math.abs(f[0]))*(y?Math.abs(f[1]):1-Math.abs(f[1]))
      if(w<1e-7)continue
      if(!x&&!y){weights.push([index,w]);continue}
      const at=c.slice();at[a]+=x*Math.sign(f[0]);at[b]+=y*Math.sign(f[1])
      const next=each(at,j=>{
        const delta=rgb(pos,j).map((v,i)=>v-center[i])
        if(pos[j*4+3]!==pos[index*4+3]||source(j)!==source(index)||dot(rgb(norm,j),n)<.995||Math.abs(dot(delta,n))>=.003)return false
        const edge=point.map((v,i)=>origin[i]+clamp(v,at[i],at[i]+1)*step-pos[j*4+i])
        return contains(j,edge,.004)
      })
      if(next>=0)weights.push([next,w])
    }
    const total=weights.reduce((sum,[,w])=>sum+w,0)
    return weights.map(([i,w])=>[i,w/total])
  }
  const cache=(index,n)=>{
    const back=dot(rgb(norm,index),n)<0,offset=index*4,k=back?2:0,albedo=rgb(rho,index)
    const directSky=dotRgb(albedo,add(scale(skyBase,sky[offset+k]),scale(lower,sky[offset+k+1])))
    const exteriorGround=scale(dotRgb(dotRgb(albedo,skyBase),groundAlbedo),ground[offset+Number(back)])
    const directSun=back===(sun[offset+3]<0)?dotRgb(rgb(sun,index),sunGain):[0,0,0]
    const firstBounce=rgb(back?firstBack:first,index),allBounce=rgb(back?lastBack:last,index)
    return {directSky,exteriorGround,directSun,firstBounce,laterBounce:allBounce.map((x,i)=>x-firstBounce[i]),
      outgoing:add(add(add(directSky,exteriorGround),directSun),allBounce)}
  }
  const blend=(weights,n)=>{
    const value=cache(weights[0][0],n)
    for(const key of Object.keys(value)){
      value[key]=weights.reduce((sum,[id,w])=>add(sum,scale(cache(id,n)[key],w)),[0,0,0])
    }
    return value
  }
  return {origin,step,dimensions:[nx,ny,nz],grids:grids.map(({points,normal,...grid})=>({...grid,normal,points:points.map(position=>{
    const id=receiver(position,normal)
    if(id<0)return {position,missing:true}
    const sn=rgb(norm,id),weights=stencil(id,position,sn),nearest=cache(id,normal),interpolated=blend(weights,normal)
    const feedbackWeights=stencil(id,position,sn,false),weighted=blend(feedbackWeights,normal)
    interpolated.directSun=nearest.directSun
    for(const key of ['firstBounce','laterBounce'])interpolated[key]=u.filterFeedback?.value?weighted[key]:nearest[key]
    interpolated.outgoing=['directSky','exteriorGround','directSun','firstBounce','laterBounce'].reduce((sum,key)=>add(sum,interpolated[key]),[0,0,0])
    const albedo=rgb(rho,id)
    return {position,patch:rgb(pos,id),id,source:source(id),material:pos[id*4+3],cell:coarse(rgb(pos,id)).map(Math.floor),normal:sn,albedo,
      nearest,interpolated,weighted,weights,feedbackWeights,visibleToAperture:nearest.directSky.some(x=>x>0)||nearest.exteriorGround.some(x=>x>0),
      incoming:interpolated.outgoing.map((x,i)=>albedo[i]>0?Math.PI*x/albedo[i]:0)}
  })}))}
}
