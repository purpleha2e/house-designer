import { getEditorState } from './rendererTestModules'
// @ts-expect-error Test-only JavaScript diagnostics have no production dependency.
import { createShaderProgramAudit } from './shaderProgramAudit.mjs'
const audit=createShaderProgramAudit();audit.interceptCanvas()
Object.assign(window,{shaderProgramAudit:audit})
await import('./rendererRecovery.tsx')
const attach=()=>{const s=getEditorState();if(s)audit.attach(s.gl,()=>s.scene.userData.viewportPreparation?.message??'tour',()=>s.scene.userData.projectGeneration);requestAnimationFrame(attach)}
requestAnimationFrame(attach)
