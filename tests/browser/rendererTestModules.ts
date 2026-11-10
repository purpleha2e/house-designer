import { _roots } from '@react-three/fiber'
export * from 'three'
export { default as Konva } from 'konva'
// Resolve through Vite so browser regressions use the app's dependency cache,
// including when a diagnostic server has its own cacheDir.
const editorRoot = () => [..._roots.values()].find(root => root.store.getState().gl?.domElement.isConnected)
export const getEditorState = () => editorRoot()?.store.getState()
export const getEditorFiber = () => editorRoot()?.fiber.current
