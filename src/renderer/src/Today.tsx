import { useState } from 'react'
import { DateTime } from 'luxon'
import type { Snapshot } from '../../shared/state'
import type { MentorResult } from '../../shared/planner'
import type { WorkflowResult } from '../../shared/workflow'
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
  const [drafts, setDrafts] = useState<
    { goalId: string; title: string; estimateMinutes: number }[]
  >([])
  const [conversation, setConversation] = useState(false)
  const now = useClock()
  const active = state.sessions.find((s) => s.state !== 'finished')
  const recurringDeferral = state.tasks.find((t) =>
    state.recurringDeferrals?.some((d) => d.taskId === t.id && d.deferredDays >= 3),
  )
  const storedPlan =
    [...state.plans].reverse().find((p) => p.status === 'proposed') ||
    [...state.plans].reverse().find((p) => p.status === 'accepted')
  const exhausted =
    result?.origin === 'availability' ||
    (storedPlan &&
      state.checkIns.some(
        (c) =>
          c.availableUntil && Date.parse(c.availableUntil) <= now && c.at > storedPlan.createdAt,
      ))
  const plan = exhausted ? undefined : storedPlan
  const time = (iso: string): string =>
    DateTime.fromISO(iso, { zone: state.profile.timezone }).toFormat('h:mm a')
  async function ask(
    text: string,
    checkIn: boolean,
    intent: 'plan' | 'conversation' = 'plan',
  ): Promise<void> {
    if (!window.dAIly) return
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      if (checkIn)
        receive(await window.dAIly.checkInAndPlan({ text, energy, until, busyStart, busyEnd }))
      else {
        const answer = await window.dAIly.askMentor(text, intent)
        setResult(answer)
        if (answer.decision.kind === 'propose_changes') setDrafts(answer.decision.tasks)
      }
      setNote('')
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  async function accept(): Promise<void> {
    if (!plan || !window.dAIly) return
    try {
      await window.dAIly.acceptPlan(plan.id)
    } catch (reason) {
      setError(String(reason))
    }
  }
  function receive(response: WorkflowResult): void {
    setResult(response.result)
    setError(response.planningError || '')
    if (response.result?.decision.kind === 'propose_changes')
      setDrafts(response.result.decision.tasks)
  }
  async function saveChanges(): Promise<void> {
    if (!result?.decisionId || result.decision.kind !== 'propose_changes' || !window.dAIly) return
    setBusy(true)
    setError('')
    try {
      await window.dAIly.approveChanges({ decisionId: result.decisionId, tasks: drafts })
      setResult(undefined)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const next = plan?.blocks.find(
    (b) =>
      b.kind === 'focus' &&
      Date.parse(b.end) > now &&
      !state.sessions.some((s) => s.blockId === b.id && s.state === 'finished'),
  )
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {active && (
        <FocusSession
          key={`${active.id}-${active.state}-${active.needsReconciliation}`}
          session={active}
          state={state}
          onPlanned={receive}
        />
      )}
      {plan ? (
        <section>
          <p className="notice">{plan.summary}</p>
          {next ? (
            <div className="next-block">
              <h2>{next.title}</h2>
              <p>
                {Math.round((Date.parse(next.end) - Date.parse(next.start)) / 60000)} minutes ·{' '}
                {time(next.start)}
              </p>
              <p className="muted">{next.reason}</p>
            </div>
          ) : (
            <p>
              No more focus blocks in this plan. You can stop here or ask for a smaller next step.
            </p>
          )}
          {plan.status === 'proposed' && (
            <>
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    plan.inputRevision === undefined ||
                    state.planningRevision !== plan.inputRevision
                  }
                  onClick={() => void accept()}
                >
                  Accept plan
                </button>
                <button
                  onClick={() => {
                    setNote('Please adjust this plan: ')
                    document.getElementById('day-update')?.focus()
                  }}
                >
                  Adjust plan
                </button>
              </div>
              {(plan.inputRevision === undefined ||
                state.planningRevision !== plan.inputRevision) && (
                <p className="notice">
                  Your records changed after this proposal. Ask for a fresh plan before accepting.
                </p>
              )}
            </>
          )}
          {plan.status === 'accepted' && next && !active && (
            <button
              className="primary"
              disabled={now < Date.parse(next.start) - 60000}
              onClick={() => {
                void window.dAIly
                  ?.sessionAction({ action: 'start', blockId: next.id })
                  .catch((reason) => setError(String(reason)))
              }}
            >
              Start focus session
            </button>
          )}
          <h2>{plan.status === 'proposed' ? 'Suggested evening' : 'Your plan'}</h2>
          <ol className="timeline">
            {plan.blocks.map((block) => (
              <li key={block.id}>
                <time dateTime={block.start}>{time(block.start)}</time>
                <div>
                  {block.title}
                  <small>
                    {time(block.end)} · {block.reason}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          {!!plan.deferred.length && (
            <details>
              <summary>Left for another day ({plan.deferred.length})</summary>
              <ul className="plain-list">
                {plan.deferred.map((d) => (
                  <li key={d.taskId}>
                    {state.tasks.find((t) => t.id === d.taskId)?.title || 'Removed task'}
                    <small>{d.reason}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : (
        <section className="empty-state">
          <h2>What fits today?</h2>
          <p>
            Tell me how much time and energy you have. Add concrete next steps in Goals so I can
            choose between them.
          </p>
        </section>
      )}
      {result && result.decision.kind !== 'propose_plan' && (
        <section aria-live="polite">
          <p>
            {result.decision.kind === 'ask_question'
              ? result.decision.question
              : result.decision.explanation}
          </p>
          {result.origin === 'availability' && (
            <small>Based on your available time. No model request was needed.</small>
          )}
          {result.decision.kind === 'propose_changes' && (
            <>
              <h2>Review these changes</h2>
              {drafts.map((task, i) => (
                <div className="task-row" key={i}>
                  <label>
                    Goal
                    <select
                      value={task.goalId}
                      onChange={(e) =>
                        setDrafts(
                          drafts.map((t, n) => (n === i ? { ...t, goalId: e.target.value } : t)),
                        )
                      }
                    >
                      {state.goals.map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Next step
                    <input
                      value={task.title}
                      onChange={(e) =>
                        setDrafts(
                          drafts.map((t, n) => (n === i ? { ...t, title: e.target.value } : t)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Minutes
                    <input
                      type="number"
                      min="5"
                      max="120"
                      value={task.estimateMinutes}
                      onChange={(e) =>
                        setDrafts(
                          drafts.map((t, n) =>
                            n === i ? { ...t, estimateMinutes: Number(e.target.value) } : t,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <p className="notice">
                {Object.entries(result.decision.preferences)
                  .map(([k, v]) => `${k === 'focusMinutes' ? 'Focus' : 'Break'}: ${v} minutes`)
                  .join(', ') || 'No preference changes.'}
              </p>
              <button disabled={busy} onClick={() => void saveChanges()}>
                Save reviewed changes
              </button>
            </>
          )}
        </section>
      )}
      <section className="composer">
        <h2>Update your day</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ask(
              note.trim() ||
                'Help me choose an achievable plan with the time and energy I reported.',
              true,
            )
          }}
        >
          {recurringDeferral && (
            <p className="notice">
              You have left {recurringDeferral.title} for later on at least three days this week.
              What has made it hard to start? You can tell me below.
            </p>
          )}
          <div className="form-grid">
            <label>
              Energy
              <select value={energy} onChange={(e) => setEnergy(e.target.value as typeof energy)}>
                <option value="unknown">Not sure</option>
                <option value="low">Low</option>
                <option value="okay">Okay</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Available until
              <input
                type="time"
                required
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </div>
          <details>
            <summary>Other unavailable time today</summary>
            <div className="form-grid">
              <label>
                From
                <input
                  type="time"
                  value={busyStart}
                  onChange={(e) => setBusyStart(e.target.value)}
                />
              </label>
              <label>
                Until
                <input type="time" value={busyEnd} onChange={(e) => setBusyEnd(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                setBusyStart('')
                setBusyEnd('')
              }}
            >
              Clear unavailable time
            </button>
          </details>
          <label>
            What changed?
            <textarea
              id="day-update"
              placeholder="I got home late. I have an exam tomorrow."
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              {busy ? 'Thinking...' : 'Plan with this update'}
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void ask(note, false, 'conversation')}
            >
              Ask mentor
            </button>
            {busy && (
              <button type="button" onClick={() => void window.dAIly?.cancelModel()}>
                Cancel
              </button>
            )}
          </div>
        </form>
        <button
          className="text-button"
          aria-expanded={conversation}
          onClick={() => setConversation(!conversation)}
        >
          {conversation ? 'Hide conversation' : 'Show conversation'}
        </button>
        {conversation && (
          <div className="conversation">
            {state.messages.slice(-20).map((m) => (
              <article key={m.id}>
                <strong>{m.role === 'user' ? state.profile.name : 'dAIly'}</strong>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
