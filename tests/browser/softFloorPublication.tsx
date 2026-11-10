import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { createIndirectField } from '../../src/indirectLighting'
import { createIndirectUniforms } from '../../src/indirectLightingShader'
import { SoftFloorGI } from '../../src/components/SoftFloorGI'

export function Filter({ generation, enabled }: { generation: number; enabled: boolean }) {
  const state = useThree()
  const [field] = useState(() => {
    const field = createIndirectField([{ id: 'floor', elevation: 0, height: 2.4, rooms: [] }], 0)
    field.floorLayer.ready = true
    return field
  })
  const [uniforms] = useState(() => createIndirectUniforms(field))
  useEffect(() => () => field.dispose(), [field])
  Object.assign(window, { floorPublication: { state, field, uniforms } })
  return <SoftFloorGI cm={enabled ? 10 : 0} snapshot={() => ({ field, generation, geometryKey: String(generation), ready: true })} uniforms={uniforms} />
}
export function Fixture() {
  const [generation, setGeneration] = useState(1), [enabled, setEnabled] = useState(true)
  const [mounted, setMounted] = useState(true), clicks = useRef(0)
  return <>
    <button id="replace" onClick={() => setGeneration(n => n + 1)}>Replace geometry</button>
    <button id="disable" onClick={() => setEnabled(false)}>Disable filter</button>
    <button id="unmount" onClick={() => setMounted(false)}>Unmount</button>
    <button id="input" onClick={event => { event.currentTarget.textContent = `Input ${++clicks.current}` }}>Input</button>
    {mounted && <div style={{ width: 64, height: 64 }}><Canvas frameloop="always" dpr={1}><Filter generation={generation} enabled={enabled} /></Canvas></div>}
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
