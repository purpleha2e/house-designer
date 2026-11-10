import '../../src/main'
import { getEditorState, Konva } from './rendererTestModules'
import { editorPreparationEvents } from '../../src/editorPreparationTrace'
Object.assign(window, { perfScene: getEditorState, recoveryKonva: Konva, editorPreparationEvents })
