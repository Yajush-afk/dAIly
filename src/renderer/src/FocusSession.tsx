import { useState } from 'react'
import type { FocusSession as Session, Snapshot } from '../../shared/state'
import type { SessionAction } from '../../shared/session'
import { useClock } from './useClock'
import type { WorkflowResult } from '../../shared/workflow'
import { explicitSubmit, MinutesInput } from './Inputs'

export function FocusSession({
  session,
  state,
  onPlanned,
}: {
  session: Session
  state: Snapshot
  onPlanned: (result: WorkflowResult) => void
}): React.JSX.Element {
  const now = useClock()
  const seconds =
    session.elapsedSeconds +
    (session.state === 'running' && session.segmentStartedAt
      ? Math.max(0, (now - Date.parse(session.segmentStartedAt)) / 1000)
      : 0)
  const remaining = Math.max(0, Math.ceil(session.targetMinutes * 60 - seconds))
  const [reportedMinutes, setReportedMinutes] = useState(Math.round(seconds / 60))
  const [outcome, setOutcome] = useState<'completed' | 'partial' | 'interrupted' | 'abandoned'>(
    'partial',
  )
  const [work, setWork] = useState('')
  const [interruption, setInterruption] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function act(command: SessionAction): Promise<void> {
    if (!window.dAIly) return
    setError('')
    setBusy(true)
    try {
      await window.dAIly.sessionAction(command)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  async function record(): Promise<void> {
    if (!window.dAIly) return
    setBusy(true)
    setError('')
    try {
      const response = await window.dAIly.recordOutcome({
        action: 'outcome',
        id: session.id,
        outcome,
        elapsedSeconds: reportedMinutes * 60,
        work,
        interruption,
      })
      onPlanned(response)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Focus session">
      <h2>
        {[...state.tasks, ...state.plans.flatMap((plan) => plan.temporaryTasks || [])].find(
          (t) => t.id === session.taskId,
        )?.title || 'Focus session'}
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="timer" aria-label="Time remaining">
        {String(Math.floor(remaining / 60)).padStart(2, '0')}:
        {String(remaining % 60).padStart(2, '0')}
      </div>
      <p className="muted">
        {session.state === 'awaiting-outcome'
          ? 'The timer ended. Completion is yours to report.'
          : session.state === 'paused'
            ? 'Paused. This time is not being counted.'
            : 'Focus time is running.'}
      </p>
      {session.needsReconciliation && (
        <>
          <p>
            Sleep or a restart left some time uncertain. Confirm the minutes you actually worked.
          </p>
          <label>
            Actual focus minutes
            <MinutesInput
              min={0}
              max={1440}
              value={reportedMinutes}
              onChange={(value) => {
                if (value !== null) setReportedMinutes(value)
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void act({
                action: 'reconcile',
                id: session.id,
                elapsedSeconds: reportedMinutes * 60,
              })
            }
          >
            Confirm time
          </button>
        </>
      )}
      {session.state !== 'awaiting-outcome' && (
        <div className="actions">
          <button
            disabled={busy || session.needsReconciliation}
            onClick={() =>
              void act({ action: session.state === 'running' ? 'pause' : 'resume', id: session.id })
            }
          >
            {session.state === 'running' ? 'Pause' : 'Resume'}
          </button>
          <button disabled={busy} onClick={() => void act({ action: 'finish', id: session.id })}>
            Finish early
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setOutcome('interrupted')
              void act({ action: 'stop', id: session.id })
            }}
          >
            Stop
          </button>
        </div>
      )}
      {session.state === 'awaiting-outcome' && (
        <form
          onKeyDown={explicitSubmit}
          onSubmit={(e) => {
            e.preventDefault()
            void record()
          }}
        >
          <h2>What happened?</h2>
          <div className="form-grid">
            <label>
              Outcome
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option value="partial">Made partial progress</option>
                <option value="completed">Completed the task</option>
                <option value="interrupted">Interrupted</option>
                <option value="abandoned">Did not work on it</option>
              </select>
            </label>
            <label>
              Actual focus minutes
              <MinutesInput
                min={0}
                max={1440}
                required
                value={reportedMinutes}
                onChange={(value) => {
                  if (value !== null) setReportedMinutes(value)
                }}
              />
            </label>
          </div>
          <label>
            Actual work
            <textarea
              value={work}
              maxLength={4000}
              onChange={(e) => setWork(e.target.value)}
              placeholder="What did you get through?"
            />
          </label>
          <label>
            What interrupted you?
            <input
              value={interruption}
              maxLength={2000}
              onChange={(e) => setInterruption(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save outcome and reconsider today'}
          </button>
        </form>
      )}
    </section>
  )
}
