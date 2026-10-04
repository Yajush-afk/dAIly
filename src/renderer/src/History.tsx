import { useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import type { Snapshot } from '../../shared/state'
import type { HistoryPage, HistoryQuery } from '../../shared/history'
import { planningLimits } from '../../shared/planning-limits'
import { Button } from './components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import { Skeleton } from './components/ui/skeleton'
import { ProgressNumbers, GoalTimeChart, DailyFocusChart, focusTime } from './ProgressCharts'
import { friendlyError } from './WorkspaceContext'

type Period = 'recent' | 'week' | 'all'
export function History({ state }: { state: Snapshot }): React.JSX.Element {
  const zone = state.profile.timezone
  const [now, setNow] = useState(() => Date.now())
  const today = DateTime.fromMillis(now, { zone }).toISODate()!
  const [period, setPeriod] = useState<Period>('recent')
  const [weekOffset, setWeekOffset] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; requestKey: string; page: HistoryPage }>()
  const [kind, setKind] = useState<'sessions' | 'plans'>('sessions')
  const [busyRequest, setBusyRequest] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ requestKey: string; message: string }>()
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const range = useMemo(() => {
    const date = DateTime.fromISO(today, { zone }).startOf('day')
    const start =
      period === 'week'
        ? date.startOf('week').plus({ weeks: weekOffset })
        : date.minus({ days: period === 'all' ? 13 : 6 })
    const end = period === 'week' ? start.plus({ weeks: 1 }) : date.plus({ days: 1 })
    return {
      start,
      count: period === 'all' ? 14 : 7,
      label:
        period === 'all'
          ? 'All recorded history'
          : `${start.toFormat('MMM d')} to ${end.minus({ days: 1 }).toFormat('MMM d, yyyy')}`,
      query: period === 'all' ? {} : { from: start.toUTC().toISO()!, until: end.toUTC().toISO()! },
    }
  }, [period, today, weekOffset, zone])
  const key = JSON.stringify([kind, period, range.query, zone, today])
  const requestKey = JSON.stringify([key, state.revision, retry])
  const error = !window.dAIly
    ? 'Open the desktop app to see your recorded progress.'
    : failure?.requestKey === requestKey
      ? failure.message
      : ''
  const loading = !!window.dAIly && loaded?.requestKey !== requestKey && !error
  const busy = busyRequest === requestKey
  useEffect(() => {
    const id = ++request.current
    let current = true
    const api = window.dAIly
    if (!api) return
    api
      .getHistory({ kind, ...range.query, limit: planningLimits.historyPageSize })
      .then((page) => {
        if (current && request.current === id) setLoaded({ key, requestKey, page })
      })
      .catch((reason) => {
        if (current && request.current === id)
          setFailure({ requestKey, message: friendlyError(reason) })
      })
    return () => {
      current = false
    }
  }, [key, requestKey, kind, range.query])
  const visible = loaded?.key === key ? loaded.page : undefined
  async function more(): Promise<void> {
    if (!visible?.next || !window.dAIly || busy || loading) return
    const id = request.current
    setBusyRequest(requestKey)
    try {
      const query: HistoryQuery = {
        kind,
        ...range.query,
        before: visible.next,
        limit: planningLimits.historyPageSize,
      }
      const next = await window.dAIly.getHistory(query)
      if (request.current !== id) return
      setLoaded((previous) =>
        previous?.key === key
          ? {
              key,
              requestKey,
              page: {
                ...next,
                sessions: [...previous.page.sessions, ...next.sessions],
                plans: [...previous.page.plans, ...next.plans],
              },
            }
          : previous,
      )
    } catch (reason) {
      if (request.current === id) setFailure({ requestKey, message: friendlyError(reason) })
    } finally {
      if (request.current === id) setBusyRequest(null)
    }
  }
  const date = (iso: string): string => DateTime.fromISO(iso, { zone }).toFormat('MMM d, h:mm a')
  const groups = new Map<string, Snapshot['sessions']>()
  for (const session of visible?.sessions ?? []) {
    const day = DateTime.fromISO(session.finishedAt ?? session.startedAt, { zone }).toISODate()!
    groups.set(day, [...(groups.get(day) ?? []), session])
  }
  return (
    <div className="progress-page">
      <div className="page-intro progress-intro">
        <div>
          <h2>Your progress</h2>
          <p>A clearer picture of the work you have recorded.</p>
        </div>
        <Select
          value={period}
          onValueChange={(value: Period) => {
            setPeriod(value)
            setWeekOffset(0)
          }}
        >
          <SelectTrigger className="progress-period" aria-label="Progress period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Last 7 days</SelectItem>
            <SelectItem value="week">Calendar week</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="progress-range">
        <p>{range.label}</p>
        {period === 'week' && (
          <div className="actions">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => setWeekOffset((offset) => offset - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!weekOffset}
              onClick={() => setWeekOffset(0)}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next week"
              disabled={weekOffset >= 0}
              onClick={() => setWeekOffset((offset) => offset + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <Tabs
        value={kind}
        onValueChange={(value) => {
          if (value === 'sessions' || value === 'plans') setKind(value)
        }}
      >
        <TabsList variant="line" className="progress-tabs" aria-label="Progress view">
          <TabsTrigger value="sessions">Reported work</TabsTrigger>
          <TabsTrigger value="plans">Earlier plans</TabsTrigger>
        </TabsList>
        <TabsContent value={kind}>
          {error && (
            <div className="progress-error" role="alert">
              <p>{error}</p>
              {window.dAIly && (
                <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
                  <RotateCcw />
                  Retry
                </Button>
              )}
            </div>
          )}
          {!visible && loading && (
            <div className="progress-loading" role="status" aria-label="Loading progress">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {visible && (
            <div aria-busy={loading}>
              {kind === 'sessions' && (
                <>
                  <ProgressNumbers totals={visible.totals} />
                  <div className="progress-charts">
                    <GoalTimeChart totals={visible.totals} goals={state.goals} />
                    <DailyFocusChart
                      totals={visible.totals}
                      start={range.start}
                      count={range.count}
                      today={today}
                    />
                  </div>
                  <p className="progress-footnote">
                    Time is counted on the day you save the outcome, in {zone}. Charts show reported
                    effort, not goal completion. Temporary tasks and deleted goals are included as
                    Unassigned goal.
                  </p>
                  <section
                    className="progress-session-history"
                    aria-labelledby="session-history-heading"
                  >
                    <div className="section-heading">
                      <h3 id="session-history-heading">Session history</h3>
                      <span className="muted">Behind the numbers</span>
                    </div>
                    {!visible.sessions.length && (
                      <p className="muted">
                        No session outcomes recorded in this period. Report a focus session to start
                        your history.
                      </p>
                    )}
                    {[...groups.entries()]
                      .sort(([a], [b]) => b.localeCompare(a))
                      .map(([day, sessions]) => (
                        <div key={day} className="progress-day-group">
                          <h4>{DateTime.fromISO(day, { zone }).toFormat('cccc, MMM d')}</h4>
                          {sessions
                            .slice()
                            .sort((a, b) =>
                              (b.finishedAt ?? b.startedAt).localeCompare(
                                a.finishedAt ?? a.startedAt,
                              ),
                            )
                            .map((session) => (
                              <details key={session.id} className="progress-session-row">
                                <summary>
                                  <span>
                                    <strong>
                                      {state.tasks.find((task) => task.id === session.taskId)
                                        ?.title ||
                                        session.taskTitle ||
                                        'Removed task'}
                                    </strong>
                                    <small>
                                      {date(session.finishedAt ?? session.startedAt)} ·{' '}
                                      {session.outcome}
                                    </small>
                                  </span>
                                  <span className="session-reported-time">
                                    {focusTime(session.elapsedSeconds)}
                                  </span>
                                </summary>
                                <div className="session-history-detail">
                                  <p className="muted">
                                    Planned {session.targetMinutes} min · reported{' '}
                                    {focusTime(session.elapsedSeconds)}
                                  </p>
                                  <p>{session.work || 'No work description recorded.'}</p>
                                  {session.interruption && (
                                    <p className="muted">Interruption: {session.interruption}</p>
                                  )}
                                </div>
                              </details>
                            ))}
                        </div>
                      ))}
                  </section>
                </>
              )}
              {kind === 'plans' && (
                <section className="progress-plans">
                  <h3>Earlier plans</h3>
                  <p className="muted">
                    Saved proposals and accepted schedules, kept as they were.
                  </p>
                  {!visible.plans.length && <p>No plans recorded in this period.</p>}
                  {visible.plans.map((plan) => (
                    <details key={plan.id} className="progress-session-row">
                      <summary>
                        <span>{date(plan.createdAt)}</span>
                        <span className="muted">{plan.status}</span>
                      </summary>
                      <div className="session-history-detail">
                        <p>{plan.summary}</p>
                        <ol className="plain-list">
                          {plan.blocks.map((block) => (
                            <li key={block.id}>
                              {block.title}
                              <small>
                                {date(block.start)} · {block.reason}
                              </small>
                            </li>
                          ))}
                        </ol>
                        {plan.deferred.map((deferred) => (
                          <p key={deferred.taskId} className="muted">
                            Deferred:{' '}
                            {state.tasks.find((task) => task.id === deferred.taskId)?.title ||
                              plan.temporaryTasks?.find((task) => task.id === deferred.taskId)
                                ?.title ||
                              'Removed task'}
                            . {deferred.reason}
                          </p>
                        ))}
                      </div>
                    </details>
                  ))}
                </section>
              )}
              {visible.next && (
                <Button variant="outline" disabled={busy || loading} onClick={() => void more()}>
                  {busy ? 'Loading...' : 'Load earlier records'}
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
