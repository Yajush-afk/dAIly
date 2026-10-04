import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { ArrowRight, Play, Clock3, SlidersHorizontal } from 'lucide-react'
import type { Snapshot, Plan } from '../../shared/state'
import type { DashboardSummary } from '../../shared/history'
import { FocusSession } from './FocusSession'
import { useClock } from './useClock'
import { useWorkspace, friendlyError } from './WorkspaceContext'
import { orderedGoals, orderedTasks } from './GoalsPage'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog'
import { explicitSubmit } from './Inputs'

export function CheckInForm({ state, close }: { state: Snapshot; close: () => void }) {
  const workspace = useWorkspace()
  const latest = state.checkIns.at(-1)
  const [energy, setEnergy] = useState<'unknown' | 'low' | 'okay' | 'high'>(
    latest?.energy || 'unknown',
  )
  const [until, setUntil] = useState(state.profile.bedtime),
    [text, setText] = useState(''),
    [busyStart, setBusyStart] = useState(''),
    [busyEnd, setBusyEnd] = useState('')
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !workspace.busy) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What fits today?</DialogTitle>
          <DialogDescription>
            A quick check-in helps dAIly make an achievable plan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="dialog-form"
          onKeyDown={explicitSubmit}
          onSubmit={async (e) => {
            e.preventDefault()
            await workspace.request({
              text:
                text.trim() ||
                'Help me choose an achievable plan with the time and energy I reported.',
              energy,
              until,
              busyStart,
              busyEnd,
            })
            close()
          }}
        >
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
              <Input
                type="time"
                required
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </div>
          <label>
            What changed?
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              placeholder="I got home late. I have an assignment due tomorrow."
            />
          </label>
          <Collapsible>
            <CollapsibleTrigger className="completed-toggle">
              Other unavailable time today
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="form-grid">
                <label>
                  From
                  <Input
                    type="time"
                    value={busyStart}
                    onChange={(e) => setBusyStart(e.target.value)}
                  />
                </label>
                <label>
                  Until
                  <Input type="time" value={busyEnd} onChange={(e) => setBusyEnd(e.target.value)} />
                </label>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="dialog-actions">
            <Button type="button" variant="outline" disabled={workspace.busy} onClick={close}>
              Cancel
            </Button>
            <Button disabled={workspace.busy}>
              {workspace.busy ? 'Thinking…' : 'Plan my day'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export function PlanProposal({ plan, state }: { plan: Plan; state: Snapshot }) {
  const workspace = useWorkspace()
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const stale = plan.inputRevision === undefined || plan.inputRevision !== state.planningRevision
  return (
    <section className="plan-proposal">
      <h3>A plan for your evening</h3>
      <p>{plan.summary}</p>
      <ol>
        {plan.blocks.map((block) => (
          <li key={block.id}>
            <span>
              {DateTime.fromISO(block.start, { zone: state.profile.timezone }).toFormat('h:mm a')}
            </span>
            <strong>{block.title}</strong>
            <small>
              {Math.round((Date.parse(block.end) - Date.parse(block.start)) / 60000)} min
            </small>
          </li>
        ))}
      </ol>
      {stale && (
        <p className="muted">
          Your situation changed. Request a fresh plan before applying this one.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <Button
          disabled={saving || stale}
          onClick={async () => {
            if (!window.dAIly || saving) return
            setSaving(true)
            try {
              await window.dAIly.acceptPlan(plan.id)
            } catch (reason) {
              setError(friendlyError(reason))
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Applying…' : 'Apply plan'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            workspace.setNote('Please adjust this plan: ')
            workspace.setMode('day')
            workspace.setOpen(true)
          }}
        >
          Adjust
        </Button>
      </div>
    </section>
  )
}
export function NextAction({
  state,
  plan,
  checkIn,
}: {
  state: Snapshot
  plan?: Plan
  checkIn: () => void
}) {
  const workspace = useWorkspace(),
    now = useClock(),
    active = state.sessions.find((s) => s.state !== 'finished')
  const [error, setError] = useState(''),
    [starting, setStarting] = useState(false)
  const next = plan?.blocks.find(
    (b) =>
      b.kind === 'focus' &&
      Date.parse(b.end) > now &&
      !state.sessions.some((s) => s.blockId === b.id && s.state === 'finished'),
  )
  const goal = state.goals.find(
    (g) => g.id === state.tasks.find((t) => t.id === next?.taskId)?.goalId,
  )
  if (active)
    return (
      <div className="next-action">
        <FocusSession
          key={`${active.id}-${active.state}-${active.needsReconciliation}`}
          session={active}
          state={state}
          onPlanned={workspace.receive}
        />
      </div>
    )
  if (plan?.status === 'proposed')
    return (
      <div className="next-action">
        <PlanProposal plan={plan} state={state} />
      </div>
    )
  return (
    <section className="next-action">
      <div className="section-heading">
        <h3>Next up</h3>
        <Clock3 size={17} />
      </div>
      {next ? (
        <>
          <p className="next-goal">{goal?.title}</p>
          <h2>{next.title}</h2>
          <p className="next-duration">
            {Math.round((Date.parse(next.end) - Date.parse(next.start)) / 60000)} minutes{' '}
            <span>
              · {DateTime.fromISO(next.start, { zone: state.profile.timezone }).toFormat('h:mm a')}
            </span>
          </p>
          <p className="next-reason">{next.reason}</p>
          <Button
            disabled={starting || now < Date.parse(next.start) - 60000}
            onClick={async () => {
              if (!window.dAIly || starting) return
              setStarting(true)
              try {
                await window.dAIly.sessionAction({ action: 'start', blockId: next.id })
              } catch (reason) {
                setError(friendlyError(reason))
              } finally {
                setStarting(false)
              }
            }}
          >
            <Play size={15} />
            {starting ? 'Starting…' : 'Start focus'}
          </Button>
        </>
      ) : (
        <>
          <h2>
            {state.goals.length ? 'Make room for what matters.' : 'Start with a goal that matters.'}
          </h2>
          <p className="next-reason">
            {state.goals.length
              ? 'Tell dAIly how your day is going. Together, choose a useful next step.'
              : 'Add a goal and a concrete sub task so dAIly has something useful to plan.'}
          </p>
          <Button onClick={checkIn}>
            Plan {plan ? 'the rest of today' : 'my day'}
            <ArrowRight size={16} />
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}
export function DayTimeline({ state, plan }: { state: Snapshot; plan?: Plan }) {
  const now = useClock(),
    today = DateTime.fromMillis(now, { zone: state.profile.timezone }),
    date = today.toISODate(),
    weekday = today.weekday % 7
  const overrides = state.timetable.filter((t) => t.date === date)
  const classes = [
    ...state.timetable.filter(
      (t) =>
        t.date === null && t.weekday === weekday && !overrides.some((o) => o.title === t.title),
    ),
    ...overrides,
  ].filter((t) => !t.cancelled)
  const rows = [
    ...classes.map((t) => ({
      id: t.id,
      title: t.title,
      start: today
        .set({ hour: Number(t.start.slice(0, 2)), minute: Number(t.start.slice(3)), second: 0 })
        .toISO()!,
      end: t.end,
      kind: 'commitment',
    })),
    ...(plan?.status === 'accepted'
      ? plan.blocks.map((b) => ({
          ...b,
          end: DateTime.fromISO(b.end, { zone: state.profile.timezone }).toFormat('HH:mm'),
        }))
      : []),
  ].sort((a, b) => a.start.localeCompare(b.start))
  const checkIn = [...state.checkIns]
    .reverse()
    .find((c) => DateTime.fromISO(c.at, { zone: state.profile.timezone }).hasSame(today, 'day'))
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <h3>Your day</h3>
        <span>{today.toFormat('ccc, d LLL')}</span>
      </div>
      <p className="muted">
        {checkIn?.availableUntil
          ? `Availability confirmed until ${DateTime.fromISO(checkIn.availableUntil, { zone: state.profile.timezone }).toFormat('h:mm a')}. Energy: ${checkIn.energy === 'unknown' ? 'not reported' : checkIn.energy}.`
          : `Expected bedtime ${state.profile.bedtime}. Availability has not been confirmed today.`}
      </p>
      <ol className="day-timeline">
        {rows.map((row) => (
          <li key={row.id}>
            <time>
              {DateTime.fromISO(row.start, { zone: state.profile.timezone }).toFormat('h:mm a')}
            </time>
            <div>
              <strong>{row.title}</strong>
              <span>
                {row.kind === 'commitment'
                  ? `College until ${row.end}`
                  : row.kind === 'break'
                    ? 'Take a proper break'
                    : 'Focus block'}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {!rows.length && <p className="empty-copy">Your plan will appear here after a check-in.</p>}
      {!!plan?.deferred.length && (
        <Collapsible>
          <CollapsibleTrigger className="completed-toggle">
            Left for another day ({plan.deferred.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            {plan.deferred.map((d) => (
              <p key={d.taskId}>
                <strong>
                  {state.tasks.find((t) => t.id === d.taskId)?.title || 'Removed task'}
                </strong>
                <br />
                <span className="muted">{d.reason}</span>
              </p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}
export function PriorityGoals({
  state,
  select,
}: {
  state: Snapshot
  select: (id?: string) => void
}) {
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <h3>Priority goals</h3>
        <Button variant="ghost" size="sm" onClick={() => select()}>
          All goals
          <ArrowRight />
        </Button>
      </div>
      <ul className="priority-list">
        {orderedGoals(state.goals)
          .slice(0, 3)
          .map((goal) => {
            const next = orderedTasks(
              state.tasks.filter((t) => t.goalId === goal.id && t.status === 'todo'),
            )[0]
            return (
              <li key={goal.id}>
                <button onClick={() => select(goal.id)}>
                  <div>
                    <strong>{goal.title}</strong>
                    <span>{next ? `Next: ${next.title}` : 'No unfinished sub tasks'}</span>
                  </div>
                  <span>{next?.deadline || goal.deadline || `Priority ${goal.priority}`}</span>
                </button>
              </li>
            )
          })}
      </ul>
      {!state.goals.length && (
        <Button variant="outline" onClick={() => select()}>
          Add your first goal
        </Button>
      )}
    </section>
  )
}
export function YesterdaySummary({ state }: { state: Snapshot }) {
  const [summary, setSummary] = useState<DashboardSummary>(),
    [error, setError] = useState('')
  const now = useClock(),
    date = DateTime.fromMillis(now, { zone: state.profile.timezone }).toISODate()
  useEffect(() => {
    let active = true
    void window.dAIly
      ?.getDashboardSummary()
      .then((value) => {
        if (active) {
          setSummary(value)
          setError('')
        }
      })
      .catch((reason) => {
        if (active) setError(friendlyError(reason))
      })
    return () => {
      active = false
    }
  }, [state.revision, date])
  return (
    <section className="dashboard-section yesterday">
      <h3>Yesterday</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !summary ? (
        <p className="muted">Loading yesterday’s records…</p>
      ) : (
        <>
          {summary.yesterday.sessions ? (
            <>
              <p className="yesterday-total">
                <strong>{Math.round(summary.yesterday.seconds / 60)} min</strong>
                <span>reported focus · {summary.yesterday.sessions} sessions</span>
              </p>
              <ul>
                {summary.yesterday.recentWork.map((s) => (
                  <li key={s.id}>
                    {s.work || state.tasks.find((t) => t.id === s.taskId)?.title || 'Focus session'}
                    <span>{s.outcome}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No work recorded yesterday.</p>
          )}
          {summary.pendingOutcomes > 0 && (
            <p className="muted">{summary.pendingOutcomes} session still needs an outcome.</p>
          )}
        </>
      )}
    </section>
  )
}
export function TodayDashboard({
  state,
  selectGoal,
}: {
  state: Snapshot
  selectGoal: (id?: string) => void
}) {
  const now = useClock(),
    [checkIn, setCheckIn] = useState(false)
  const today = DateTime.fromMillis(now, { zone: state.profile.timezone })
  const plan = [...state.plans]
    .reverse()
    .find(
      (p) =>
        p.status !== 'superseded' &&
        p.blocks.some((b) => Date.parse(b.end) > now) &&
        DateTime.fromISO(p.createdAt, { zone: state.profile.timezone }).hasSame(today, 'day'),
    )
  return (
    <div className="today-dashboard">
      <div className="page-intro">
        <div>
          <p className="today-date">{today.toFormat('EEEE, d LLLL')}</p>
          <h2>
            {today.hour < 12 ? 'Good morning' : today.hour < 18 ? 'Good afternoon' : 'Good evening'}
            , {state.profile.name}.
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Update availability"
          onClick={() => setCheckIn(true)}
        >
          <SlidersHorizontal />
        </Button>
      </div>
      <NextAction
        state={state}
        plan={plan}
        checkIn={() => (state.goals.length ? setCheckIn(true) : selectGoal())}
      />
      <DayTimeline state={state} plan={plan} />
      <PriorityGoals state={state} select={selectGoal} />
      <YesterdaySummary state={state} />
      {checkIn && <CheckInForm state={state} close={() => setCheckIn(false)} />}
    </div>
  )
}
