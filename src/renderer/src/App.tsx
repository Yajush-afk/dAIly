import { useEffect, useState } from 'react'
import { defaultProfile, type Config, type Snapshot } from '../../shared/state'
import { configFrom, GoalsEditor, ProfileEditor } from './Editors'

export type Page = 'Today' | 'Goals' | 'History' | 'Settings'
export type Theme = 'system' | 'light' | 'dark'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('Today')
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('daily-theme') as Theme) || 'system')
  const [state, setState] = useState<Snapshot>({ revision: 0, profile: defaultProfile, goals: [], tasks: [], timetable: [], checkIns: [], plans: [], sessions: [], messages: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const api = window.dAIly
    if (!api) return
    let active = true
    void api.getState().then(value => { if (active) { setState(value); setTheme(value.profile.theme) } }).catch(reason => { if (active) setError(String(reason)) })
    const unsubscribe = api.onState(value => { setState(value); setTheme(value.profile.theme) })
    return () => { active = false; unsubscribe() }
  }, [])
  async function save(config: Config): Promise<void> {
    if (!window.dAIly) { setError('Open the desktop application to save your records. This browser is a visual preview.'); return }
    setBusy(true); setError('')
    try { setState(await window.dAIly.saveConfig(config)) } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('daily-theme', theme) }, [theme])
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="#today" onClick={() => setPage('Today')}>d<span>AI</span>ly</a>
      <nav>{(['Today', 'Goals', 'History', 'Settings'] as Page[]).map(item => <button key={item} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button>)}</nav>
      <p className="sidebar-foot">On your laptop.<br />At your pace.</p>
    </aside>
    <main className="workspace">
      <div className="page-content">
        <header className="page-header"><h1>{page}</h1><span className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span></header>
        {error && <p role="alert" className="error">{error}</p>}
        {!window.dAIly && <p className="notice">Browser preview. Open dAIly on your desktop to save records and use local AI.</p>}
        {page === 'Today' && !state.profile.onboardingComplete && <ProfileEditor key={`onboard-${state.revision}`} state={state} save={save} busy={busy} />}
        {page === 'Today' && state.profile.onboardingComplete && <section className="empty-state"><h2>Your first plan starts here</h2><p>Add your schedule and a few concrete goals. dAIly will help decide what fits when your day changes.</p><button className="primary" onClick={() => setPage('Goals')}>Add your goals</button></section>}
        {page === 'Goals' && <GoalsEditor key={`goals-${state.revision}`} state={state} save={save} busy={busy} />}
        {page === 'History' && <section className="empty-state"><h2>A record of what happened</h2><p>Completed and interrupted sessions will appear here. There is nothing to catch up on yet.</p></section>}
        {page === 'Settings' && <><section><h2>Appearance</h2><label className="setting-row">Theme<select value={theme} onChange={event => { const next = event.target.value as Theme; setTheme(next); if (window.dAIly) void save({ ...configFrom(state), profile: { ...state.profile, theme: next } }) }}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label></section><section><ProfileEditor key={`profile-${state.revision}`} state={state} save={save} busy={busy} /></section></>}
      </div>
    </main>
  </div>
}
