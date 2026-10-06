import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import Konva from 'konva'
import App from '../../src/App'
import '../../src/index.css'

// Exercise the application's actual Create and Save handlers, rather than a
// fixture callback that simply copies the placement options.
Object.assign(window, {
  roofCreateStage: () => Konva.stages[0],
  roofCreateScene: () => [..._roots.values()][0]?.store.getState().scene,
})
createRoot(document.getElementById('root')!).render(<App />)
