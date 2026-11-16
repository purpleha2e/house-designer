import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import Konva from 'konva'
import { createShaderProgramAudit } from './shaderProgramAudit.mjs'
import { App } from '../../src/App'
import project from '../fixtures/roofShaderRoom.json'
import '../../src/index.css'
const audit = createShaderProgramAudit()

Object.assign(window, { roofAudit: audit, roofCreateStage: () => Konva.stages[0],
  roofState: () => [..._roots.values()][0]?.store.getState() })
createRoot(document.getElementById('root')!).render(<App initialProjectSource={project} />)
