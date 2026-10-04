import { DateTime } from 'luxon'
import type { Snapshot } from '../../shared/state'
export function History({ state }: { state: Snapshot }): React.JSX.Element {
  const finished = [...state.sessions].filter(s => s.state === 'finished').reverse()
  const date = (iso: string): string => DateTime.fromISO(iso, { zone: state.profile.timezone }).toFormat('MMM d, h:mm a')
  return <><section><h2>What actually happened</h2><p className="notice">{finished.length} reported sessions · {Math.round(finished.reduce((sum, s) => sum + s.elapsedSeconds / 60, 0))} reported focus minutes</p>
    {!finished.length && <p>Your session outcomes will appear here.</p>}
    <ul className="plain-list">{finished.map(s => <li key={s.id}><strong>{state.tasks.find(t => t.id === s.taskId)?.title || state.plans.flatMap(p => p.blocks).find(b => b.id === s.blockId)?.title || 'Removed task'}</strong><small>{date(s.startedAt)} · {s.outcome} · planned {s.targetMinutes} min, reported {Math.round(s.elapsedSeconds / 60)} min</small><p>{s.work || 'No work description recorded.'}</p>{s.interruption && <p className="muted">Interruption: {s.interruption}</p>}</li>)}</ul>
    </section><section><h2>Earlier plans</h2><p className="notice">These revisions preserve what was proposed at the time.</p>{[...state.plans].reverse().map(p => <details key={p.id}><summary>{date(p.createdAt)} · {p.status}</summary><p>{p.summary}</p><ol className="plain-list">{p.blocks.map(b => <li key={b.id}>{b.title}<small>{date(b.start)} · {b.reason}</small></li>)}</ol>{p.deferred.map(d => <p key={d.taskId} className="muted">Deferred: {state.tasks.find(t => t.id === d.taskId)?.title || 'Removed task'}. {d.reason}</p>)}</details>)}</section></>
}
