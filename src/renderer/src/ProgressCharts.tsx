import { useState } from 'react'
import { DateTime } from 'luxon'
import type { HistoryPage } from '../../shared/history'
import type { Snapshot } from '../../shared/state'

export function focusTime(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const remainder = minutes % 60
  return `${Math.floor(minutes / 60)} h${remainder ? ` ${remainder} min` : ''}`
}

export function ProgressNumbers({ totals }: { totals: HistoryPage['totals'] }): React.JSX.Element {
  const recordedDays = totals.byDay.filter((day) => day.sessions > 0).length
  return (
    <dl className="progress-numbers">
      <div>
        <dt>Reported focus time</dt>
        <dd>{focusTime(totals.seconds)}</dd>
        <small>From saved session outcomes</small>
      </div>
      <div>
        <dt>Sessions reported</dt>
        <dd>{totals.sessions}</dd>
        <small>Including interrupted sessions</small>
      </div>
      <div>
        <dt>Days with records</dt>
        <dd>{recordedDays}</dd>
        <small>Missing days remain unknown</small>
      </div>
      <div>
        <dt>Average session</dt>
        <dd>{totals.sessions ? focusTime(totals.seconds / totals.sessions) : '0 min'}</dd>
        <small>Reported time per session</small>
      </div>
    </dl>
  )
}

export function GoalTimeChart({
  totals,
  goals,
}: {
  totals: HistoryPage['totals']
  goals: Snapshot['goals']
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const allocated = totals.byGoal
    .filter((row) => row.seconds > 0)
    .map((row) => ({
      id: row.goalId ?? 'unassigned',
      title: goals.find((goal) => goal.id === row.goalId)?.title ?? 'Unassigned goal',
      seconds: row.seconds,
      sessions: row.sessions,
    }))
  const slices = allocated.slice(0, 5)
  if (allocated.length > 5)
    slices.push({
      id: 'other',
      title: 'Other goals',
      seconds: allocated.slice(5).reduce((sum, row) => sum + row.seconds, 0),
      sessions: allocated.slice(5).reduce((sum, row) => sum + row.sessions, 0),
    })
  const active = slices.find((row) => row.id === selected)
  const arcs = slices.map((row, index) => ({
    ...row,
    color: `var(--chart-${index + 1})`,
    share: totals.seconds ? (row.seconds / totals.seconds) * 100 : 0,
    offset:
      (slices.slice(0, index).reduce((sum, slice) => sum + slice.seconds, 0) / totals.seconds) *
      100,
  }))
  return (
    <section className="goal-time-chart" aria-labelledby="goal-time-heading">
      <h3 id="goal-time-heading">Where your time went</h3>
      <p className="muted">Your share of reported focus time by goal.</p>
      <div className="goal-chart-layout">
        <div className="focus-donut">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={
              slices.length
                ? `Focus time by goal. ${slices.map((row) => `${row.title}: ${focusTime(row.seconds)}`).join('. ')}`
                : 'No reported focus time in this period'
            }
          >
            <circle cx="100" cy="100" r="78" fill="none" stroke="var(--line)" strokeWidth="18" />
            {arcs.map((arc) => (
              <circle
                key={arc.id}
                cx="100"
                cy="100"
                r="78"
                fill="none"
                pathLength="100"
                stroke={arc.color}
                strokeWidth="18"
                strokeDasharray={`${Math.max(0, arc.share - (arcs.length > 1 ? Math.min(0.8, arc.share / 4) : 0))} 100`}
                strokeDashoffset={-arc.offset}
                transform="rotate(-90 100 100)"
                opacity={active && active.id !== arc.id ? 0.25 : 1}
              >
                <title>
                  {arc.title}: {focusTime(arc.seconds)}, {Math.round(arc.share)}%
                </title>
              </circle>
            ))}
          </svg>
          <div className="donut-total" aria-live="polite">
            <strong>{focusTime(active?.seconds ?? totals.seconds)}</strong>
            <span>{active?.title ?? 'Reported focus'}</span>
          </div>
        </div>
        {arcs.length ? (
          <ul className="goal-chart-legend">
            {arcs.map((arc) => (
              <li key={arc.id}>
                <button
                  type="button"
                  aria-pressed={active?.id === arc.id}
                  onClick={() => setSelected(active?.id === arc.id ? null : arc.id)}
                >
                  <span
                    className="chart-swatch"
                    style={{ background: arc.color }}
                    aria-hidden="true"
                  />
                  <span className="legend-label">
                    <strong>{arc.title}</strong>
                    <small>
                      {arc.sessions} {arc.sessions === 1 ? 'session' : 'sessions'}
                    </small>
                  </span>
                  <span className="legend-amount">
                    <strong>{focusTime(arc.seconds)}</strong>
                    <small>{Math.round(arc.share)}%</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Report a session outcome to see how your time is shared across goals.
          </p>
        )}
      </div>
    </section>
  )
}

export function DailyFocusChart({
  totals,
  start,
  count,
  today,
}: {
  totals: HistoryPage['totals']
  start: DateTime
  count: number
  today: string
}): React.JSX.Element {
  const totalsByDay = new Map(totals.byDay.map((day) => [day.date, day]))
  const days = Array.from({ length: count }, (_, index) => {
    const date = start.plus({ days: index })
    const row = totalsByDay.get(date.toISODate()!)
    return { date, seconds: row?.seconds ?? 0, sessions: row?.sessions ?? 0 }
  })
  const maximum = Math.max(60, ...days.map((day) => day.seconds))
  return (
    <section className="daily-focus-chart" aria-labelledby="daily-focus-heading">
      <div className="section-heading">
        <h3 id="daily-focus-heading">Focus by day</h3>
        <span className="muted">{focusTime(maximum)} scale</span>
      </div>
      <p className="muted">
        {count === 14
          ? 'The latest 14 calendar days. Totals above cover all time.'
          : 'Reported time, grouped by the day the outcome was saved.'}
      </p>
      <div
        className="daily-focus-bars"
        data-compact={count === 14}
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <div className="daily-focus-column" key={day.date.toISODate()}>
            <div
              className="daily-bar-track"
              title={`${day.date.toFormat('MMMM d')}: ${focusTime(day.seconds)}`}
              role="img"
              aria-label={`${day.date.toFormat('MMMM d')}: ${focusTime(day.seconds)}, ${day.sessions} reported sessions`}
            >
              <span className="daily-bar-value">{day.seconds ? focusTime(day.seconds) : ''}</span>
              <div
                className="daily-bar-fill"
                style={{ height: `${(day.seconds / maximum) * 100}%` }}
                data-today={day.date.toISODate() === today}
              />
            </div>
            <span className="daily-bar-day" data-today={day.date.toISODate() === today}>
              {day.date.toFormat(count === 14 ? 'd' : 'ccc')}
            </span>
            {count === 7 && <small>{day.date.toFormat('d')}</small>}
          </div>
        ))}
      </div>
    </section>
  )
}
