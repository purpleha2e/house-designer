import { getEditorState } from './rendererTestModules'
import { editorPreparationEvents } from '../../src/editorPreparationTrace'
// @ts-expect-error Test-only JavaScript diagnostics have no production dependency.
import { createShaderProgramAudit } from './shaderProgramAudit.mjs'
const audit=createShaderProgramAudit()
audit.interceptCanvas()
Object.assign(window,{shaderProgramAudit:audit,perfScene:getEditorState,editorPreparationEvents})
await import('../../src/main')
const attach=()=>{const s=getEditorState();if(s)audit.attach(s.gl,()=>s.scene.userData.viewportPreparation?.message??s.scene.userData.progressiveStartup?.phase??'scene',()=>s.scene.userData.projectGeneration);requestAnimationFrame(attach)}
requestAnimationFrame(attach)
