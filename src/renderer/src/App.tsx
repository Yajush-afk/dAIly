import { useEffect, useState } from 'react'
import { defaultProfile, type Config, type Snapshot } from '../../shared/state'
import { configFrom, GoalsEditor, ProfileEditor } from './Editors'
import { ModelSetup } from './ModelSetup'
import { Today } from './Today'
import { History } from './History'

export type Page = 'Today' | 'Goals' | 'History' | 'Settings'
export type Theme = 'system' | 'light' | 'dark'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('Today')
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem('daily-theme') as Theme) || 'system',
  )
  const [state, setState] = useState<Snapshot>({
    revision: 0,
    profile: defaultProfile,
    goals: [],
    tasks: [],
    timetable: [],
    checkIns: [],
    plans: [],
    sessions: [],
    messages: [],
  })
  const [busy, setBusy] = useState(false)
  const [goalsDirty, setGoalsDirty] = useState(false)
  const [error, setError] = useState('')
  const [exportNotice, setExportNotice] = useState('')
  const [loading, setLoading] = useState(() => !!window.dAIly)
  useEffect(() => {
    const api = window.dAIly
    if (!api) return
    let active = true
    void api
      .getState()
      .then((value) => {
        if (active) {
          setState(value)
          setTheme(value.profile.theme)
        }
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = api.onState((value) => {
      setState((previous) => ({ ...previous, ...value }))
      if (value.profile) setTheme(value.profile.theme)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  async function save(config: Config): Promise<boolean> {
    if (!window.dAIly) {
      setError(
        'Open the desktop application to save your records. This browser is a visual preview.',
      )
      return false
    }
    setBusy(true)
    setError('')
    try {
      setState(await window.dAIly.saveConfig(config))
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('daily-theme', theme)
  }, [theme])
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#today" onClick={() => setPage('Today')}>
          d<span>AI</span>ly
        </a>
        <nav>
          {(['Today', 'Goals', 'History', 'Settings'] as Page[]).map((item) => (
            <button
              key={item}
              aria-current={page === item ? 'page' : undefined}
              onClick={() => setPage(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <p className="sidebar-foot">
          On your laptop.
          <br />
          At your pace.
        </p>
      </aside>
      <main className="workspace">
        <div className="page-content">
          <header className="page-header">
            <h1>{page}</h1>
            <span className="muted">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </header>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {goalsDirty && page !== 'Goals' && (
            <p role="status" className="notice">
              Your goal edits are not saved yet. Open Goals and save them before planning.
              <button type="button" onClick={() => setPage('Goals')}>
                Return to Goals
              </button>
            </p>
          )}
          {loading && (
            <p role="status" className="notice">
              Loading your saved day...
            </p>
          )}
          {!window.dAIly && (
            <p className="notice">
              Browser preview. Open dAIly on your desktop to save records and use local AI.
            </p>
          )}
          {page === 'Today' && !loading && !state.profile.onboardingComplete && (
            <ProfileEditor
              key={JSON.stringify([state.profile, state.timetable])}
              state={state}
              save={save}
              busy={busy}
              importSchedule={() => window.dAIly?.importSchedule() || Promise.resolve(undefined)}
            />
          )}
          {page === 'Today' && state.profile.onboardingComplete && (
            <Today state={state} onOpenGoals={() => setPage('Goals')} goalsDirty={goalsDirty} />
          )}
          {!loading && (
            <div hidden={page !== 'Goals'} className="page-content">
              <GoalsEditor
                state={state}
                save={save}
                busy={busy}
                navigate={() => setPage('Today')}
                onDirty={setGoalsDirty}
              />
            </div>
          )}
          {page === 'History' && <History state={state} />}
          {page === 'Settings' && (
            <>
              <section>
                <h2>Appearance</h2>
                <p className="muted">Choose a comfortable light or dark workspace.</p>
                <label className="setting-row">
                  Theme
                  <select
                    value={theme}
                    onChange={(event) => {
                      const next = event.target.value as Theme
                      setTheme(next)
                      if (window.dAIly)
                        void save({
                          ...configFrom(state),
                          profile: { ...state.profile, theme: next },
                        })
                    }}
                  >
                    <option value="system">Follow system</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
              </section>
              <ModelSetup />
              <section>
                <ProfileEditor
                  key={JSON.stringify([state.profile, state.timetable])}
                  state={state}
                  save={save}
                  busy={busy}
                  importSchedule={() =>
                    window.dAIly?.importSchedule() || Promise.resolve(undefined)
                  }
                />
              </section>
              <section>
                <h2>Your data</h2>
                <p className="notice">
                  Planning records stay on this laptop. Export includes your profile, tasks, plans,
                  session outcomes, and conversation.
                </p>
                <button
                  onClick={() => {
                    void window.dAIly
                      ?.exportData()
                      .then((result) => {
                        if (!result.cancelled) setExportNotice(`Saved to ${result.path}`)
                      })
                      .catch((reason) => setError(String(reason)))
                  }}
                >
                  Export local records
                </button>
                {exportNotice && (
                  <p role="status" className="notice">
                    {exportNotice}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
