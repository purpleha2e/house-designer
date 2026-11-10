import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountDialog } from '../../src/components/AccountDialog'
import { Toolbar } from '../../src/components/Toolbar'
import '../../src/index.css'
import '../../src/App.css'

const noop = () => {}
export function Harness() {
  const [menu, setMenu] = useState(false), [account, setAccount] = useState(false)
  return <main style={{ padding: 20 }}>
    <button type="button" aria-label="Project menu" onClick={() => setMenu(value => !value)}>Project menu</button>
    <p>The editor remains available without signing in.</p>
    {menu && <Toolbar onClose={() => setMenu(false)} isEngineConsoleOpen={false} onEngineConsoleOpenChange={noop}
      onNewProject={noop} onLoadProject={noop} onSaveProject={noop} onOpenManufacturerPortal={noop}
      onSaveToDevice={noop} onSaveToCloud={noop} canSave={false} isSaving={false}
      onOpenMaterialEditor={noop} onOpenAccount={() => setAccount(true)} />}
    {account && <AccountDialog onClose={() => setAccount(false)} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
