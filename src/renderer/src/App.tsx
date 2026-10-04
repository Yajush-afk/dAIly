import { useEffect, useState } from 'react'

export type Page = 'Today' | 'Goals' | 'History' | 'Settings'
export type Theme = 'system' | 'light' | 'dark'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('Today')
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('daily-theme') as Theme) || 'system')
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
        {page === 'Today' && <section className="empty-state"><h2>Your first plan starts here</h2><p>Add your schedule and a few concrete goals. dAIly will help decide what fits when your day changes.</p><button className="primary" onClick={() => setPage('Goals')}>Add your goals</button></section>}
        {page === 'Goals' && <section className="empty-state"><h2>Make the next step clear</h2><p>Your goals and their next tasks will appear here.</p></section>}
        {page === 'History' && <section className="empty-state"><h2>A record of what happened</h2><p>Completed and interrupted sessions will appear here. There is nothing to catch up on yet.</p></section>}
        {page === 'Settings' && <section><h2>Appearance</h2><label className="setting-row">Theme<select value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label></section>}
      </div>
    </main>
  </div>
}
