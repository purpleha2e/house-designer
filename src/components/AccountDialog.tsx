import { useEffect, useRef, useState, type FormEvent } from 'react'
import { workspaceClient, formatWorkspaceBytes, type WorkspaceSession } from '../workspace/workspaceClient'
import './AccountDialog.css'

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const controller = useRef<AbortController | null>(null)
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [action, setAction] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current, pending = new AbortController()
    controller.current = pending
    element?.showModal()
    void workspaceClient.session(pending.signal).then(setSession).catch(error => {
      if (!pending.signal.aborted) { setUnavailable(true); setMessage(error instanceof Error ? error.message : 'Could not load your account.') }
    }).finally(() => { if (!pending.signal.aborted) setLoading(false) })
    return () => { pending.abort(); element?.close(); if (previous?.isConnected) previous.focus() }
  }, [])

  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    const signal = controller.current?.signal
    if (busy || !signal || signal.aborted) return
    setBusy(true); setMessage('')
    try { await operation(signal) }
    catch (error) { if (!signal.aborted) setMessage(error instanceof Error ? error.message : 'The request failed. Please try again.') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void run(async signal => {
      const next = await workspaceClient.authenticate(action, { name: String(fields.get('name') ?? ''),
        email: String(fields.get('email') ?? ''), password: String(fields.get('password') ?? '') }, signal)
      setSession(next)
    })
  }
  return <dialog ref={dialog} className="account-dialog" aria-label="Account and private workspace"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><div><span className="account-eyebrow">HOUSE DESIGNER</span><h1>Account &amp; workspace</h1></div>
      <button type="button" aria-label="Close account" disabled={busy} onClick={onClose}>Close</button></header>
    <p className="account-development">Local development service. Accounts and files are stored on this computer. Hosted accounts and publishing are being connected separately.</p>
    {loading ? <p role="status">Connecting to your workspace…</p> : unavailable ? <div>
      <p role="alert">{message}</p><p>You can continue creating and saving houses without signing in.</p>
      <button type="button" disabled={busy} onClick={() => void run(async signal => {
        const next = await workspaceClient.session(signal)
        setSession(next); setUnavailable(false)
      })}>Try again</button>
    </div> : session?.user && session.workspace ? <>
      <section className="account-summary"><div><h2>{session.user.name}</h2><p>{session.user.email}</p></div>
        <button type="button" disabled={busy} onClick={() => void run(async signal => {
          await workspaceClient.logout(signal); setSession(current => current ? { ...current, user: null, workspace: null } : null)
          setAction('login'); setMessage('Signed out.')
        })}>Sign out</button></section>
      <section className="account-storage" aria-label="Workspace storage">
        <h2>Private storage</h2>
        <p>{formatWorkspaceBytes(session.workspace.usedBytes)} used of {formatWorkspaceBytes(session.workspace.quotaBytes)}</p>
        <progress value={session.workspace.usedBytes} max={session.workspace.quotaBytes} aria-label="Storage used" />
      </section>
      <p role="status" className="account-message">{message}</p>
    </> : <>
      <div className="account-tabs" aria-label="Account action">
        <button type="button" disabled={busy} aria-pressed={action === 'login'} onClick={() => { setAction('login'); setMessage('') }}>Sign in</button>
        <button type="button" disabled={busy} aria-pressed={action === 'register'} onClick={() => { setAction('register'); setMessage('') }}>Create account</button>
      </div>
      <form key={action} className="account-form" onSubmit={authenticate}>
        {action === 'register' && <label>Name<input name="name" autoComplete="name" required minLength={2} maxLength={80} disabled={busy} /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label>
        <label>Password<input name="password" type="password" autoComplete={action === 'register' ? 'new-password' : 'current-password'}
          required minLength={action === 'register' ? 12 : undefined} maxLength={128} disabled={busy} /></label>
        {action === 'register' && <small>Use at least 12 characters.</small>}
        <button className="account-primary" disabled={busy}>{busy ? 'Please wait…' : action === 'register' ? 'Create private workspace' : 'Sign in'}</button>
        <p role="status" className="account-message">{message}</p>
      </form>
      <p>You can create and save houses locally without an account.</p>
    </>}
  </dialog>
}
