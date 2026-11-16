import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { App } from '../../src/App'
import project from '../fixtures/roofShaderRoom.json'
import '../../src/index.css'
const projectUrl=new URLSearchParams(location.search).get('project')
const singleWall=projectUrl?await(await fetch(projectUrl)).json():{...project,surfaceAssignments:[],floors:project.floors.map(f=>({...f,walls:f.walls.slice(0,1),rooms:[]}))}
Object.assign(window,{roofState:()=>[..._roots.values()][0]?.store.getState()})
createRoot(document.getElementById('root')!).render(<App initialProjectSource={singleWall} />)
