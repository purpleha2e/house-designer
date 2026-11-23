import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { HouseLightingLab } from '../../src/lightingLab/houseEngine'
import { prepareHouseGeometry, type HousePart } from '../../src/lightingLab/houseGeometry'
const parts: HousePart[] = []
const quad = (name: string, centre: number[], u: number[], v: number[], material = 0) => {
  const position = [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]].flatMap(([x,y]) => centre.map((c,i) => c+x*u[i]+y*v[i]))
  parts.push({ name, position: new Float32Array(position), structural: true, matrices: [new Matrix4().toArray()], ranges: [{ start:0, count:6, material }] })
}
quad('Back receiver',[0,1.5,3],[-2,0,0],[0,1.5,0],1)
quad('Left wall',[-2,1.5,0],[0,0,-3],[0,1.5,0])
quad('Right wall',[2,1.5,0],[0,0,3],[0,1.5,0])
quad('Ceiling',[0,3,0],[2,0,0],[0,0,3])
quad('Floor',[0,0,0],[2,0,0],[0,0,-3])
for(const z of [-3,0]) {
  quad('Door left',[-1.25,1.5,z],[.75,0,0],[0,1.5,0])
  quad('Door right',[1.25,1.5,z],[.75,0,0],[0,1.5,0])
  quad('Door header',[0,2.5,z],[.5,0,0],[0,.5,0])
}
if(new URLSearchParams(location.search).has('closed'))quad('Closed interior door',[0,1,0],[.5,0,0],[0,1,0])
const camera=new PerspectiveCamera(45,1,.01,100);camera.position.set(0,1,2);camera.lookAt(new Vector3(0,1,3))
const finishes=[0,.8].map(value=>({colour:[value,value,value],emission:[0,0,0],map:null,alphaTest:0,side:2}))
const snapshot={parts,finishes,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:45,prototypeDaylight:true}
const lab=new HouseLightingLab(document.querySelector<HTMLElement>('#viewport')!,snapshot,prepareHouseGeometry(parts,()=>{}))
Object.assign(window,{houseLightingLab:lab,houseFixtureSnapshot:snapshot});lab.setInput({lights:[],sunDirection:[0,1,0],sunColour:[0,0,0],daylight:true})
await lab.start(()=>{},()=>{},()=>{})
