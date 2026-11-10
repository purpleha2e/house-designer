import {readFileSync,writeFileSync} from 'node:fs'
import {PerspectiveCamera,Vector3} from 'three'
import sharp from 'sharp'
const results=[]
for(const label of ['reference-full','final-gesture','final-edits']){
 const dir=`tmp/selection-recovery/${label}`,r=JSON.parse(readFileSync(`${dir}/report.json`,'utf8')),targets=JSON.parse(readFileSync(`${dir}/candidates.json`,'utf8')).targets,p=targets.find(t=>t.id===r.steps[0].target.id)
 const camera=new PerspectiveCamera(50,695/900,.1,1000);camera.position.fromArray(r.initial.camera);camera.rotation.fromArray(r.initial.rotation);camera.updateMatrixWorld(true)
 const v=new Vector3(...p.center).applyMatrix4(camera.matrixWorldInverse),focal=(p.x-1051.5)*-v.z/v.x
 camera.fov=2*Math.atan(450/focal)*180/Math.PI;camera.updateProjectionMatrix()
 const regions=r.steps.slice(0,2).map(s=>{
  const t=targets.find(t=>t.id===s.target.id),points=[];for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){const q=new Vector3(t.center[0]+t.size[0]*x,t.center[1]+t.size[1]*y,t.center[2]+t.size[2]*z).project(camera);points.push({x:704+(q.x+1)*695/2,y:(1-q.y)*900/2})}
  const left=Math.floor(Math.min(...points.map(p=>p.x)))-1,top=Math.floor(Math.min(...points.map(p=>p.y)))-1,right=Math.ceil(Math.max(...points.map(p=>p.x)))+1,bottom=Math.ceil(Math.max(...points.map(p=>p.y)))+1
  return{id:t.id,left,top,right,bottom,threshold:Math.max(12,(right-left)*(bottom-top)*.025)}
 })
 const frames=[]
 for(const f of r.frames){const {data,info}=await sharp(`${dir}/${f.file}`).raw().toBuffer({resolveWithObject:true});frames.push({file:f.file,at:f.at,regions:regions.map(a=>{let blue=0;for(let y=Math.max(0,a.top);y<Math.min(info.height,a.bottom);y++)for(let x=Math.max(0,a.left);x<Math.min(info.width,a.right);x++){const i=(y*info.width+x)*info.channels;if(data[i+2]>data[i]+20&&data[i+1]>data[i]+8)blue++}return{id:a.id,blue,selected:blue>a.threshold}})})}
 const inputs=r.raw.events.filter(e=>e.kind==='test.input'),measurements=inputs.slice(0,6).map((m,i)=>{const end=inputs[i+1]?.at??Infinity,events=r.raw.events.filter(e=>e.at>=m.at&&e.at<end),up=events.find(e=>e.kind==='picker.pointerup'),pick=events.find(e=>e.kind==='pick.result'),commit=events.find(e=>e.kind==='react.selection.commit'),frame=frames.find(f=>f.at>=(commit?.at??pick?.at??m.at)&&f.at<end&&f.regions.every(a=>a.selected===(a.id===pick?.modelId)));return{label:m.label,pointerAt:up?.eventAt,stateAt:commit?.at,frame:frame?.file,frameAt:frame?.at,ms:frame&&up?frame.at-up.eventAt:undefined}})
 const result={label,limit:'Headless compositor capture metadata estimates; not monitor photon timing. JPEG blue-pixel classification uses projected world bounds, independently of GL submissions.',fov:camera.fov,regions,measurements,frames};writeFileSync(`${dir}/frame-analysis.json`,JSON.stringify(result,null,2));results.push({label,measurements})
}
console.log(JSON.stringify(results,null,2))
