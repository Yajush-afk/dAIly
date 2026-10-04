import { useEffect, useState } from 'react'
import { defaultProfile, type Config, type Snapshot } from '../../shared/state'
import { configFrom, ProfileEditor } from './Editors'
import { ModelSetup } from './ModelSetup'
import { History } from './History'
import { AppShell, useMedia } from './AppShell'
import { WorkspaceProvider, useConversationController, friendlyError } from './WorkspaceContext'
import { ConversationPanel } from './ConversationPanel'
import { TodayDashboard } from './TodayDashboard'
import { GoalsPage } from './GoalsPage'
import { Skeleton } from './components/ui/skeleton'
import { Button } from './components/ui/button'

export type Page = 'Today' | 'Goals' | 'Progress' | 'Settings'
export type Theme = 'system' | 'light' | 'dark'
export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('Today'),
    [selectedGoal, setSelectedGoal] = useState<string>()
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [exportNotice, setExportNotice] = useState(''),
    [loading, setLoading] = useState(() => !!window.dAIly)
  const workspace = useConversationController(state),
    darkSystem = useMedia('(prefers-color-scheme: dark)')
  useEffect(() => {
    const api = window.dAIly
    if (!api) return
    let active = true
    void api
      .getState()
      .then((value) => {
        if (active) setState(value)
      })
      .catch((reason) => {
        if (active) setError(friendlyError(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = api.onState((value) => setState((previous) => ({ ...previous, ...value })))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    const theme = state.profile.theme
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle(
      'dark',
      theme === 'dark' || (theme === 'system' && darkSystem),
    )
    localStorage.setItem('daily-theme', theme)
  }, [state.profile.theme, darkSystem])
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
      setError(friendlyError(reason))
      return false
    } finally {
      setBusy(false)
    }
  }
  const selectGoal = (id?: string) => {
    setSelectedGoal(id)
    setPage('Goals')
  }
  return (
    <WorkspaceProvider value={workspace}>
      <AppShell
        page={page}
        navigate={setPage}
        conversation={<ConversationPanel onSaved={setState} settings={() => setPage('Settings')} />}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <div className="loading-workspace" role="status" aria-label="Loading your saved day">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {!window.dAIly && (
              <p className="preview-note">
                Browser preview. Open the desktop app to save records and use local AI.
              </p>
            )}
            {page === 'Today' &&
              (state.profile.onboardingComplete ? (
                <TodayDashboard state={state} selectGoal={selectGoal} />
              ) : (
                <ProfileEditor
                  key={JSON.stringify([state.profile, state.timetable])}
                  state={state}
                  save={save}
                  busy={busy}
                  importSchedule={() =>
                    window.dAIly?.importSchedule() || Promise.resolve(undefined)
                  }
                />
              ))}
            <div hidden={page !== 'Goals'}>
              <GoalsPage
                state={state}
                save={save}
                selectedId={selectedGoal}
                select={setSelectedGoal}
              />
            </div>
            {page === 'Progress' && <History state={state} />}
            {page === 'Settings' && (
              <div className="legacy-settings">
                <section>
                  <h2>Appearance</h2>
                  <p className="muted">Choose a comfortable light or dark workspace.</p>
                  <label>
                    Theme
                    <select
                      value={state.profile.theme}
                      onChange={(event) => {
                        const profile = { ...state.profile, theme: event.target.value as Theme }
                        if (window.dAIly) void save({ ...configFrom(state), profile })
                        else setState((previous) => ({ ...previous, profile }))
                      }}
                    >
                      <option value="system">Follow system</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                </section>
                <ModelSetup />
                <ProfileEditor
                  key={JSON.stringify([state.profile, state.timetable])}
                  state={state}
                  save={save}
                  busy={busy}
                  importSchedule={() =>
                    window.dAIly?.importSchedule() || Promise.resolve(undefined)
                  }
                />
                <section>
                  <h2>Your data</h2>
                  <p className="muted">
                    Export your planning records, session outcomes, and conversation.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void window.dAIly
                        ?.exportData()
                        .then((result) => {
                          if (!result.cancelled) setExportNotice(`Saved to ${result.path}`)
                        })
                        .catch((reason) => setError(friendlyError(reason)))
                    }}
                  >
                    Export local records
                  </Button>
                  {exportNotice && <p role="status">{exportNotice}</p>}
                </section>
              </div>
            )}
          </>
        )}
      </AppShell>
    </WorkspaceProvider>
  )
}
