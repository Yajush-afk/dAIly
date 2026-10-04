import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { Snapshot } from '../../shared/state'
import type { HistoryPage } from '../../shared/history'
import { planningLimits } from '../../shared/planning-limits'

export function History({ state }: { state: Snapshot }): React.JSX.Element {
  const [page, setPage] = useState<HistoryPage>()
  const [kind, setKind] = useState<'sessions' | 'plans'>('sessions')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!window.dAIly) return
    let current = true
    window.dAIly
      .getHistory({ kind, limit: planningLimits.historyPageSize })
      .then((value) => {
        if (current) {
          setPage(value)
          setError('')
        }
      })
      .catch((reason) => {
        if (current) setError(String(reason))
      })
    return () => {
      current = false
    }
  }, [kind, state.planningRevision])
  async function more(): Promise<void> {
    if (!page?.next || !window.dAIly || busy) return
    setBusy(true)
    try {
      const next = await window.dAIly.getHistory({
        kind,
        before: page.next,
        limit: planningLimits.historyPageSize,
      })
      setPage((previous) =>
        previous?.kind === next.kind
          ? {
              ...next,
              sessions: [...previous.sessions, ...next.sessions],
              plans: [...previous.plans, ...next.plans],
            }
          : previous,
      )
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const date = (iso: string): string =>
    DateTime.fromISO(iso, { zone: state.profile.timezone }).toFormat('MMM d, h:mm a')
  const visible = page?.kind === kind ? page : undefined
  return (
    <>
      <div className="actions">
        <button aria-pressed={kind === 'sessions'} onClick={() => setKind('sessions')}>
          Reported work
        </button>
        <button aria-pressed={kind === 'plans'} onClick={() => setKind('plans')}>
          Earlier plans
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!visible && !error && <p role="status">Loading history...</p>}
      {visible && (
        <section>
          <h2>{kind === 'sessions' ? 'What actually happened' : 'Earlier plans'}</h2>
          <p className="notice">
            {visible.totals.sessions} reported sessions · {Math.round(visible.totals.seconds / 60)}{' '}
            reported focus minutes
          </p>
          {kind === 'sessions' && (
            <ul className="plain-list">
              {visible.sessions.map((s) => (
                <li key={s.id}>
                  <strong>
                    {state.tasks.find((t) => t.id === s.taskId)?.title || 'Removed task'}
                  </strong>
                  <small>
                    {date(s.startedAt)} · {s.outcome} · planned {s.targetMinutes} min, reported{' '}
                    {Math.round(s.elapsedSeconds / 60)} min
                  </small>
                  <p>{s.work || 'No work description recorded.'}</p>
                  {s.interruption && <p className="muted">Interruption: {s.interruption}</p>}
                </li>
              ))}
            </ul>
          )}
          {kind === 'plans' &&
            visible.plans.map((p) => (
              <details key={p.id}>
                <summary>
                  {date(p.createdAt)} · {p.status}
                </summary>
                <p>{p.summary}</p>
                <ol className="plain-list">
                  {p.blocks.map((b) => (
                    <li key={b.id}>
                      {b.title}
                      <small>
                        {date(b.start)} · {b.reason}
                      </small>
                    </li>
                  ))}
                </ol>
                {p.deferred.map((d) => (
                  <p key={d.taskId} className="muted">
                    Deferred: {state.tasks.find((t) => t.id === d.taskId)?.title || 'Removed task'}.{' '}
                    {d.reason}
                  </p>
                ))}
              </details>
            ))}
          {!visible.sessions.length && !visible.plans.length && <p>No records yet.</p>}
          {visible.next && (
            <button disabled={busy} onClick={() => void more()}>
              {busy ? 'Loading...' : 'Load earlier records'}
            </button>
          )}
        </section>
      )}
    </>
  )
}
