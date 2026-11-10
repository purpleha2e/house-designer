import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchDefaultProject } from '../projectBootstrap'

function LoadFailure({ message, retry, startNew }: { message: string; retry: () => void; startNew: () => void }) {
  return <section role="alert"><h1>The default project could not be opened</h1><p>{message}</p>
    <button onClick={retry}>Retry default project</button>{' '}<button onClick={startNew}>Start a new project</button>
  </section>
}
class BootstrapBoundary extends Component<{ children: ReactNode; retry: () => void; startNew: () => void }, { error?: string }> {
  state: { error?: string } = {}
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) } }
  render() { return this.state.error ? <LoadFailure message={this.state.error} retry={this.props.retry} startNew={this.props.startNew} /> : this.props.children }
}

/** Loading never mounts a temporary house. New is an explicit user choice and
 * revokes the pending request, so a late Colin response cannot replace it. */
export function ProjectBootstrap({ validate, render }: { validate: (source: unknown) => boolean; render: (source: unknown) => ReactNode }) {
  const [state, setState] = useState<{ kind: 'loading' | 'ready' | 'new' | 'error'; source?: unknown; error?: string }>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0), epoch = useRef(0), pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const id = ++epoch.current, controller = new AbortController(); pending.current = controller
    let cancelled = false
    void fetchDefaultProject(controller.signal).then(source => {
      if (cancelled || epoch.current !== id) return
      if (!validate(source)) throw new Error('The default house is not a valid project file.')
      setState({ kind: 'ready', source })
    }).catch(error => {
      if (!cancelled && epoch.current === id && !controller.signal.aborted) setState({ kind: 'error', error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true; controller.abort() }
  }, [attempt, validate])
  const startNew = () => { epoch.current++; pending.current?.abort(); setState({ kind: 'new' }) }
  const retry = () => { epoch.current++; pending.current?.abort(); setState({ kind: 'loading' }); setAttempt(value => value + 1) }
  if (state.kind === 'ready' || state.kind === 'new') return <BootstrapBoundary key={`${attempt}:${state.kind}`} retry={retry} startNew={startNew}>{render(state.source)}</BootstrapBoundary>
  return <main style={{ padding: 32, fontFamily: 'system-ui', color: '#17283c' }}>
    {state.kind === 'error' ? <LoadFailure message={state.error ?? 'Unknown load error'} retry={retry} startNew={startNew} /> :
      <section role="status" aria-busy="true"><h1>Opening Colin’s house…</h1><p>The default design is loading.</p><button onClick={startNew}>Start a new project</button></section>}
  </main>
}
