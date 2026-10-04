import { useState } from 'react'
import { DateTime } from 'luxon'
import type { Snapshot } from '../../shared/state'
import type { MentorResult } from '../../shared/planner'
import { configFrom } from './Editors'
import { useClock } from './useClock'
import { FocusSession } from './FocusSession'

export function Today({ state }: { state: Snapshot }): React.JSX.Element {
  const [note, setNote] = useState('')
  const [energy, setEnergy] = useState<'unknown' | 'low' | 'okay' | 'high'>('unknown')
  const [until, setUntil] = useState(state.profile.bedtime)
  const [busyStart, setBusyStart] = useState('')
  const [busyEnd, setBusyEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MentorResult>()
  const [drafts, setDrafts] = useState<{ goalId: string; title: string; estimateMinutes: number }[]>([])
  const [conversation, setConversation] = useState(false)
  const now = useClock()
  const active = state.sessions.find(s => s.state !== 'finished')
  const recurringDeferral = state.tasks.filter(t => t.status === 'todo').find(t => new Set(state.plans.filter(p => now - Date.parse(p.createdAt) < 7 * 86400000 && p.deferred.some(d => d.taskId === t.id)).map(p => DateTime.fromISO(p.createdAt).setZone(state.profile.timezone).toISODate())).size >= 3)
  const plan = [...state.plans].reverse().find(p => p.status === 'proposed') || [...state.plans].reverse().find(p => p.status === 'accepted')
  const time = (iso: string): string => DateTime.fromISO(iso, { zone: state.profile.timezone }).toFormat('h:mm a')
  async function ask(text: string, checkIn: boolean): Promise<void> {
    if (!window.dAIly) return
    setBusy(true); setError(''); setResult(undefined)
    try {
      if (checkIn) {
        const now = DateTime.now().setZone(state.profile.timezone)
        const [hour, minute] = until.split(':').map(Number)
        let cutoff = now.set({ hour, minute, second: 0, millisecond: 0 })
        if (cutoff < now && until < state.profile.wakeTime) cutoff = cutoff.plus({ days: 1 })
        const obligations: { start: string; end: string; title: string }[] = []
        if (busyStart || busyEnd) {
          if (!busyStart || !busyEnd) throw new Error('Enter both ends of your unavailable time.')
          const instant = (value: string): DateTime => { const [h, m] = value.split(':').map(Number); let date = now.set({ hour: h, minute: m, second: 0, millisecond: 0 }); if (value < state.profile.wakeTime && date < now) date = date.plus({ days: 1 }); return date }
          const start = instant(busyStart), end = instant(busyEnd)
          if (end <= start) throw new Error('Unavailable time must end after it starts.')
          obligations.push({ start: start.toUTC().toISO()!, end: end.toUTC().toISO()!, title: 'Other commitment' })
        }
        await window.dAIly.saveCheckIn({ id: crypto.randomUUID(), at: now.toUTC().toISO()!, availableUntil: cutoff.toUTC().toISO()!, energy, note: text, busy: obligations })
      }
      const answer = await window.dAIly.askMentor(text)
      setResult(answer)
      if (answer.decision.kind === 'propose_changes') setDrafts(answer.decision.tasks)
      setNote('')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  async function accept(): Promise<void> {
    if (!plan || !window.dAIly) return
    try { await window.dAIly.acceptPlan(plan.id) } catch (reason) { setError(String(reason)) }
  }
  async function saveChanges(): Promise<void> {
    if (!result || result.decision.kind !== 'propose_changes' || !window.dAIly) return
    if (result.revision !== state.revision) { setError('Your records changed. Ask for a fresh suggestion.'); return }
    setBusy(true); setError('')
    try {
      await window.dAIly.saveConfig({ ...configFrom(state), tasks: [...state.tasks, ...drafts.map(t => ({ ...t, id: crypto.randomUUID(), status: 'todo' as const, deadline: null }))], profile: { ...state.profile, ...result.decision.preferences } })
      setResult(undefined)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const next = plan?.blocks.find(b => b.kind === 'focus' && Date.parse(b.end) > now && !state.sessions.some(s => s.blockId === b.id && s.state === 'finished'))
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {active && <FocusSession key={`${active.id}-${active.state}-${active.needsReconciliation}`} session={active} state={state} onRecorded={() => ask('I saved my actual session outcome. Reconsider the remaining day using that outcome, and ask about an obstacle if the same task keeps being deferred.', false)} />}
    {plan ? <section>
      <p className="notice">{plan.summary}</p>
      {next ? <div className="next-block"><h2>{next.title}</h2><p>{Math.round((Date.parse(next.end) - Date.parse(next.start)) / 60000)} minutes · {time(next.start)}</p><p className="muted">{next.reason}</p></div> : <p>No more focus blocks in this plan. You can stop here or ask for a smaller next step.</p>}
      {plan.status === 'proposed' && <><div className="actions"><button className="primary" disabled={busy || state.revision !== plan.contextRevision + 2} onClick={() => void accept()}>Accept plan</button><button onClick={() => { setNote('Please adjust this plan: '); document.getElementById('day-update')?.focus() }}>Adjust plan</button></div>{state.revision !== plan.contextRevision + 2 && <p className="notice">Your records changed after this proposal. Ask for a fresh plan before accepting.</p>}</>}
      {plan.status === 'accepted' && next && !active && <button className="primary" disabled={now < Date.parse(next.start) - 60000} onClick={() => { void window.dAIly?.sessionAction({ action: 'start', blockId: next.id }).catch(reason => setError(String(reason))) }}>Start focus session</button>}
      <h2>{plan.status === 'proposed' ? 'Suggested evening' : 'Your plan'}</h2>
      <ol className="timeline">{plan.blocks.map(block => <li key={block.id}><time dateTime={block.start}>{time(block.start)}</time><div>{block.title}<small>{time(block.end)} · {block.reason}</small></div></li>)}</ol>
      {!!plan.deferred.length && <details><summary>Left for another day ({plan.deferred.length})</summary><ul className="plain-list">{plan.deferred.map(d => <li key={d.taskId}>{state.tasks.find(t => t.id === d.taskId)?.title || 'Removed task'}<small>{d.reason}</small></li>)}</ul></details>}
    </section> : <section className="empty-state"><h2>What fits today?</h2><p>Tell me how much time and energy you have. Add concrete next steps in Goals so I can choose between them.</p></section>}
    {result && result.decision.kind !== 'propose_plan' && <section aria-live="polite"><p>{result.decision.kind === 'ask_question' ? result.decision.question : result.decision.explanation}</p>
      {result.decision.kind === 'propose_changes' && <><h2>Review these changes</h2>{drafts.map((task, i) => <div className="task-row" key={i}><label>Next step<input value={task.title} onChange={e => setDrafts(drafts.map((t, n) => n === i ? { ...t, title: e.target.value } : t))} /></label><label>Minutes<input type="number" min="5" max="120" value={task.estimateMinutes} onChange={e => setDrafts(drafts.map((t, n) => n === i ? { ...t, estimateMinutes: Number(e.target.value) } : t))} /></label></div>)}
        <p className="notice">{Object.entries(result.decision.preferences).map(([k, v]) => `${k === 'focusMinutes' ? 'Focus' : 'Break'}: ${v} minutes`).join(', ') || 'No preference changes.'}</p>
        <button disabled={busy} onClick={() => void saveChanges()}>Save reviewed changes</button></>}
    </section>}
    <section className="composer"><h2>Update your day</h2><form onSubmit={e => { e.preventDefault(); void ask(note.trim() || 'Help me choose an achievable plan with the time and energy I reported.', true) }}>
      {recurringDeferral && <p className="notice">You have left {recurringDeferral.title} for later on at least three days this week. What has made it hard to start? You can tell me below.</p>}
      <div className="form-grid"><label>Energy<select value={energy} onChange={e => setEnergy(e.target.value as typeof energy)}><option value="unknown">Not sure</option><option value="low">Low</option><option value="okay">Okay</option><option value="high">High</option></select></label><label>Available until<input type="time" required value={until} onChange={e => setUntil(e.target.value)} /></label></div>
      <details><summary>Other unavailable time today</summary><div className="form-grid"><label>From<input type="time" value={busyStart} onChange={e => setBusyStart(e.target.value)} /></label><label>Until<input type="time" value={busyEnd} onChange={e => setBusyEnd(e.target.value)} /></label></div><button type="button" onClick={() => { setBusyStart(''); setBusyEnd('') }}>Clear unavailable time</button></details>
      <label>What changed?<textarea id="day-update" placeholder="I got home late. I have an exam tomorrow." value={note} maxLength={4000} onChange={e => setNote(e.target.value)} /></label>
      <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Thinking...' : 'Plan with this update'}</button><button type="button" disabled={busy || !note.trim()} onClick={() => void ask(note, false)}>Ask mentor</button>{busy && <button type="button" onClick={() => void window.dAIly?.cancelModel()}>Cancel</button>}</div>
    </form><button className="text-button" aria-expanded={conversation} onClick={() => setConversation(!conversation)}>{conversation ? 'Hide conversation' : 'Show conversation'}</button>
    {conversation && <div className="conversation">{state.messages.slice(-20).map(m => <article key={m.id}><strong>{m.role === 'user' ? state.profile.name : 'dAIly'}</strong><p>{m.text}</p></article>)}</div>}</section>
  </>
}
