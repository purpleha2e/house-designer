import * as Three from 'three'
import { getEditorState, getEditorFiber, Konva } from './rendererTestModules'
import { ImportedModelBatching } from '../../src/importedModelBatching'
import { editorPreparationEvents } from '../../src/editorPreparationTrace'
import { failShaderWarmup, shaderWarmupGeneration } from '../../src/shaderWarmupState'
// @ts-expect-error Diagnostic JavaScript is isolated from the production build.
import { installSelectionRecoveryAudit } from './selectionRecoveryAudit.mjs'
const audit=installSelectionRecoveryAudit({ getEditorState, getEditorFiber, Three, ImportedModelBatching, Konva,
  injectFailure: () => { const scene=getEditorState()?.scene;if(scene)failShaderWarmup(scene,shaderWarmupGeneration(scene),new Error('Diagnostic injected preparation failure')) } })
Object.assign(window,{selectionAudit:audit,editorPreparationEvents})
await import('../../src/main')
