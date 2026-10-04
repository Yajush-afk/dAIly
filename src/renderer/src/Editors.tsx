import { useRef, useState } from 'react'
import type { Config, Goal, Profile, Snapshot, Task, TimetableEntry } from '../../shared/state'
import { explicitSubmit, MinutesInput } from './Inputs'
import type { ScheduleImportResult } from '../../shared/timetable-import'
import { GoalDiscussion } from './GoalDiscussion'
import { NewGoalDialog } from './NewGoalDialog'

export function configFrom(state: Snapshot): Config {
  return {
    profile: state.profile,
    goals: state.goals,
    tasks: state.tasks,
    timetable: state.timetable,
  }
}
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const timezoneOptions: string[] = (() => {
  try {
    return (
      (
        Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
      ).supportedValuesOf?.('timeZone') || []
    )
  } catch {
    return []
  }
})()

export function ProfileEditor({
  state,
  save,
  busy,
  importSchedule,
}: {
  state: Snapshot
  save: (config: Config) => Promise<boolean>
  busy: boolean
  importSchedule: () => Promise<ScheduleImportResult | undefined>
}): React.JSX.Element {
  const [profile, setProfile] = useState<Profile>(state.profile)
  const [timetable, setTimetable] = useState<TimetableEntry[]>(state.timetable)
  const [entry, setEntry] = useState({ weekday: 1, start: '09:00', end: '17:00', cancelled: false })
  const [method, setMethod] = useState<'manual' | 'upload'>('manual')
  const [schedule, setSchedule] = useState<ScheduleImportResult>()
  const [scheduleDraft, setScheduleDraft] = useState<
    Record<number, { start: string; end: string; off: boolean }>
  >({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const field = <K extends keyof Profile>(key: K, value: Profile[K]): void =>
    setProfile((old) => {
      const next = { ...old, [key]: value }
      if (next.quietDuringSleep) {
        next.quietStart = next.bedtime
        next.quietEnd = next.wakeTime
      }
      return next
    })
  const applyExtracted = (): void => {
    if (!schedule) return
    const imported = [] as TimetableEntry[]
    for (const weekday of weekdays.keys()) {
      const found = schedule.extraction.days.find((day) => day.weekday === weekday),
        edit = scheduleDraft[weekday]
      if (edit?.off) continue
      const start = edit?.start ?? found?.start ?? '',
        end = edit?.end ?? found?.end ?? ''
      if (!start && !end) continue
      if (!start || !end || end <= start) {
        setUploadError(
          'Finish both times for ' + weekdays[weekday] + ' or mark that day as no college.',
        )
        return
      }
      imported.push({
        id: crypto.randomUUID(),
        weekday,
        date: null,
        title: 'College',
        start,
        end,
        cancelled: false,
      })
    }
    if (imported.length === 0) {
      setUploadError(
        'No college hours are ready to save. Enter at least one weekday time or use manual entry.',
      )
      return
    }
    setTimetable([
      ...timetable.filter((item) => item.date || item.title !== 'College'),
      ...imported,
    ])
    setSchedule(undefined)
  }
  return (
    <form
      onKeyDown={explicitSubmit}
      onSubmit={(event) => {
        event.preventDefault()
        void save({
          ...configFrom(state),
          profile: {
            ...profile,
            onboardingComplete: true,
            quietStart: profile.quietDuringSleep ? profile.bedtime : profile.quietStart,
            quietEnd: profile.quietDuringSleep ? profile.wakeTime : profile.quietEnd,
          },
          timetable,
        })
      }}
    >
      <h2>{state.profile.onboardingComplete ? 'Your preferences' : 'Let us know who you are'}</h2>
      <p className="notice">
        Tell dAIly the basics that shape a realistic day. You can change any of this later.
      </p>
      <section>
        <h2>Your routine</h2>
        <p className="muted">This helps dAIly estimate the time and structure that work for you.</p>
        <div className="form-grid">
          <label>
            Name
            <input required value={profile.name} onChange={(e) => field('name', e.target.value)} />
          </label>
          <label>
            Timezone
            <select value={profile.timezone} onChange={(e) => field('timezone', e.target.value)}>
              {!timezoneOptions.includes(profile.timezone) && (
                <option value={profile.timezone}>{profile.timezone}</option>
              )}
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Usual bedtime
            <input
              type="time"
              required
              value={profile.bedtime}
              onChange={(e) => field('bedtime', e.target.value)}
            />
          </label>
          <label>
            Usual wake time
            <input
              type="time"
              required
              value={profile.wakeTime}
              onChange={(e) => field('wakeTime', e.target.value)}
            />
          </label>
          <label>
            Commute, minutes
            <input
              type="number"
              min="0"
              max="240"
              value={profile.commuteMinutes}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (e.target.value && Number.isInteger(v)) field('commuteMinutes', v)
              }}
            />
          </label>
          <label>
            Usual focus block, minutes
            <MinutesInput
              value={profile.focusMinutes}
              onChange={(value) => {
                if (value !== null) field('focusMinutes', value)
              }}
            />
          </label>
          <label>
            Break between blocks, minutes
            <MinutesInput
              min={5}
              max={60}
              value={profile.breakMinutes}
              onChange={(value) => {
                if (value !== null) field('breakMinutes', value)
              }}
            />
          </label>
        </div>
      </section>
      <section>
        <h2>College schedule</h2>
        <p className="muted">
          Add recurring start and end times by weekday. dAIly reserves the whole interval as
          college.
        </p>
        <div className="schedule-methods" role="group" aria-label="College schedule entry method">
          <button
            type="button"
            className={`schedule-method${method === 'manual' ? ' selected' : ''}`}
            aria-pressed={method === 'manual'}
            onClick={() => setMethod('manual')}
          >
            Enter manually
          </button>
          <button
            type="button"
            className={`schedule-method${method === 'upload' ? ' selected' : ''}`}
            aria-pressed={method === 'upload'}
            onClick={() => setMethod('upload')}
          >
            Upload a timetable
          </button>
        </div>
        {method === 'manual' ? (
          <div className="inline-fields">
            <label>
              Weekday
              <select
                value={entry.weekday}
                onChange={(e) => setEntry({ ...entry, weekday: Number(e.target.value) })}
              >
                {weekdays.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              College starts
              <input
                type="time"
                value={entry.start}
                disabled={entry.cancelled}
                onChange={(e) => setEntry({ ...entry, start: e.target.value })}
              />
            </label>
            <label>
              College ends
              <input
                type="time"
                value={entry.end}
                disabled={entry.cancelled}
                onChange={(e) => setEntry({ ...entry, end: e.target.value })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={entry.cancelled}
                onChange={(e) => setEntry({ ...entry, cancelled: e.target.checked })}
              />
              No college this weekday
            </label>
            <button
              type="button"
              disabled={!entry.cancelled && entry.end <= entry.start}
              onClick={() => {
                const old = timetable.filter(
                  (item) => item.date || item.weekday !== entry.weekday || item.title !== 'College',
                )
                setTimetable([
                  ...old,
                  {
                    id: crypto.randomUUID(),
                    title: 'College',
                    weekday: entry.weekday,
                    date: null,
                    start: entry.start,
                    end: entry.end,
                    cancelled: entry.cancelled,
                  },
                ])
              }}
            >
              Add weekday
            </button>
          </div>
        ) : (
          <div>
            <p className="muted">
              Choose an image, CSV, or Excel file. Gemma reads it on this laptop, then asks you to
              check the weekly times before saving.
            </p>
            <button
              type="button"
              disabled={uploading}
              onClick={() => {
                setUploading(true)
                setUploadError('')
                setSchedule(undefined)
                void importSchedule()
                  .then((value) => {
                    setSchedule(value)
                    setScheduleDraft(
                      Object.fromEntries(
                        (value?.extraction.days || []).map((day) => [
                          day.weekday,
                          { start: day.start, end: day.end, off: false },
                        ]),
                      ),
                    )
                    if (!value) setUploadError('No file selected.')
                  })
                  .catch((error) => setUploadError(String(error)))
                  .finally(() => setUploading(false))
              }}
            >
              {uploading ? 'Reading timetable…' : 'Choose timetable file'}
            </button>
            {uploading && (
              <button type="button" onClick={() => void window.dAIly?.cancelModel()}>
                Cancel upload
              </button>
            )}
            {uploadError && (
              <p role="alert" className="error">
                {uploadError}
              </p>
            )}
            {schedule && (
              <div className="schedule-review">
                <h3>Check the times dAIly found</h3>
                <p className="muted">
                  {schedule.filename}. These entries repeat each week. Edit unclear times before
                  saving.
                </p>
                {schedule.extraction.questions.map((q, i) => (
                  <p className="notice" key={i}>
                    {q}
                  </p>
                ))}
                {weekdays.map((day, weekday) => {
                  const found = schedule.extraction.days.find((item) => item.weekday === weekday),
                    edit = scheduleDraft[weekday]
                  return (
                    <div className="inline-fields" key={day}>
                      <strong>{day}</strong>
                      <label>
                        Starts
                        <input
                          aria-label={day + ' college starts'}
                          type="time"
                          disabled={edit?.off}
                          value={edit?.start ?? found?.start ?? ''}
                          onChange={(e) =>
                            setScheduleDraft((old) => ({
                              ...old,
                              [weekday]: {
                                start: e.target.value,
                                end: old[weekday]?.end ?? found?.end ?? '',
                                off: false,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Ends
                        <input
                          aria-label={day + ' college ends'}
                          type="time"
                          disabled={edit?.off}
                          value={edit?.end ?? found?.end ?? ''}
                          onChange={(e) =>
                            setScheduleDraft((old) => ({
                              ...old,
                              [weekday]: {
                                start: old[weekday]?.start ?? found?.start ?? '',
                                end: e.target.value,
                                off: false,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={edit?.off ?? false}
                          onChange={(e) =>
                            setScheduleDraft((old) => ({
                              ...old,
                              [weekday]: {
                                start: old[weekday]?.start ?? found?.start ?? '',
                                end: old[weekday]?.end ?? found?.end ?? '',
                                off: e.target.checked,
                              },
                            }))
                          }
                        />
                        No college
                      </label>
                    </div>
                  )
                })}
                <button type="button" className="primary" onClick={applyExtracted}>
                  Use this recurring schedule
                </button>
              </div>
            )}
          </div>
        )}
        {timetable
          .filter((item) => item.title === 'College')
          .sort((a, b) => a.weekday - b.weekday)
          .map((item) => (
            <div className="row" key={item.id}>
              <p className="row-main">
                {weekdays[item.weekday]} ·{' '}
                {item.cancelled ? 'No college' : item.start + ' to ' + item.end}
                <small>Weekly</small>
              </p>
              <button
                type="button"
                onClick={() => setTimetable((old) => old.filter((value) => value.id !== item.id))}
              >
                Remove
              </button>
            </div>
          ))}
      </section>
      <section>
        <h2>Check-ins and quiet hours</h2>
        <p className="muted">
          Choose whether dAIly can remind you and when notifications should stay quiet.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.notifications}
            onChange={(e) => field('notifications', e.target.checked)}
          />
          Allow desktop notifications
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.arrivalCheckIn}
            onChange={(e) => field('arrivalCheckIn', e.target.checked)}
          />
          Ask how the day changed after my expected commute
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.quietDuringSleep || false}
            onChange={(e) => field('quietDuringSleep', e.target.checked)}
          />
          Quiet hours match my sleep time
        </label>
        <div className="form-grid">
          <label>
            Quiet hours start
            <input
              type="time"
              disabled={profile.quietDuringSleep}
              value={profile.quietDuringSleep ? profile.bedtime : profile.quietStart}
              onChange={(e) => field('quietStart', e.target.value)}
            />
          </label>
          <label>
            Quiet hours end
            <input
              type="time"
              disabled={profile.quietDuringSleep}
              value={profile.quietDuringSleep ? profile.wakeTime : profile.quietEnd}
              onChange={(e) => field('quietEnd', e.target.value)}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.launchAtLogin}
            onChange={(e) => field('launchAtLogin', e.target.checked)}
          />
          Open dAIly when I sign in
        </label>
      </section>
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </form>
  )
}

export function GoalsEditor({
  state,
  save,
  busy,
  navigate,
  onDirty,
}: {
  state: Snapshot
  save: (config: Config) => Promise<boolean>
  busy: boolean
  navigate: (page: 'Today') => void
  onDirty: (dirty: boolean) => void
}): React.JSX.Element {
  const [goals, setGoals] = useState<Goal[]>(state.goals)
  const [tasks, setTasks] = useState<Task[]>(state.tasks)
  const [selectedId, setSelectedId] = useState<string | undefined>(state.goals[0]?.id)
  const [view, setView] = useState<'edit' | 'list'>('edit')
  const [creating, setCreating] = useState(false)
  const newGoalButton = useRef<HTMLButtonElement>(null)
  const closeCreation = (): void => {
    setCreating(false)
    queueMicrotask(() => newGoalButton.current?.focus())
  }
  const selectedIndex = goals.findIndex((goal) => goal.id === selectedId)
  const selectedGoal = goals[selectedIndex]
  const updateGoal = (id: string, patch: Partial<Goal>): void => {
    onDirty(true)
    setGoals((old) => old.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)))
  }
  const updateTask = (id: string, patch: Partial<Task>): void => {
    onDirty(true)
    setTasks((old) => old.map((task) => (task.id === id ? { ...task, ...patch } : task)))
  }
  const saveDraft = async (): Promise<boolean> => {
    const saved = await save({ ...configFrom(state), goals, tasks })
    if (saved) onDirty(false)
    return saved
  }
  const acceptSaved = (next: Snapshot): void => {
    setGoals(next.goals)
    setTasks(next.tasks)
    onDirty(false)
  }
  const sorted = (goalId: string): Task[] =>
    tasks
      .filter((task) => task.goalId === goalId)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
  return (
    <form
      onKeyDown={explicitSubmit}
      onSubmit={(event) => {
        event.preventDefault()
        void saveDraft()
      }}
    >
      <div className="goal-toolbar">
        <div className="actions">
          <button
            type="button"
            className="outlined"
            aria-label="Previous goal"
            disabled={view !== 'edit' || selectedIndex <= 0}
            onClick={() => setSelectedId(goals[selectedIndex - 1]?.id)}
          >
            ←
          </button>
          <button
            type="button"
            className="outlined"
            aria-label="Next goal"
            disabled={view !== 'edit' || selectedIndex < 0 || selectedIndex >= goals.length - 1}
            onClick={() => setSelectedId(goals[selectedIndex + 1]?.id)}
          >
            →
          </button>
          {view === 'edit' && selectedGoal && (
            <span className="muted">
              {selectedIndex + 1} of {goals.length}
            </span>
          )}
        </div>
        <div className="actions">
          <button
            type="button"
            className="outlined"
            aria-pressed={view === 'list'}
            onClick={() => setView(view === 'list' ? 'edit' : 'list')}
          >
            My Goals
          </button>
          <button
            ref={newGoalButton}
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New Goal
          </button>
        </div>
      </div>
      {creating && (
        <NewGoalDialog
          onClose={closeCreation}
          create={async (goal) => {
            const nextGoals = [...goals, goal]
            if (!(await save({ ...configFrom(state), goals: nextGoals, tasks }))) return false
            setGoals(nextGoals)
            onDirty(false)
            setSelectedId(goal.id)
            setView('edit')
            closeCreation()
            return true
          }}
        />
      )}
      {view === 'list' && (
        <section aria-label="My Goals">
          {!goals.length && <p className="muted">Add your first goal with New Goal.</p>}
          {goals.map((goal) => (
            <details className="goal-summary" key={goal.id}>
              <summary>{goal.title || 'Untitled goal'}</summary>
              <p className="muted">
                Priority {goal.priority}
                {goal.deadline ? ` · Due ${goal.deadline}` : ''}
              </p>
              <ul>
                {sorted(goal.id).map((task) => (
                  <li key={task.id}>
                    {task.title || 'Untitled subtask'}
                    {task.deadline ? ` · ${task.deadline}` : ''}
                    {task.status === 'done' ? ' · Done' : ''}
                  </li>
                ))}
              </ul>
              {!sorted(goal.id).length && <p className="muted">No subtasks yet.</p>}
              <button
                type="button"
                className="outlined"
                onClick={() => {
                  setSelectedId(goal.id)
                  setView('edit')
                }}
              >
                Edit goal
              </button>
            </details>
          ))}
        </section>
      )}
      {view === 'edit' && !selectedGoal && (
        <p className="notice">Add your first goal with New Goal.</p>
      )}
      {view === 'edit' && selectedGoal && (
        <p className="notice">
          Your goals compete for the same time. Priority 5 is most important. Add the effort you
          hope to spend on a goal each day; dAIly will adjust its suggestions as today changes.
        </p>
      )}
      {goals
        .filter((goal) => view === 'edit' && goal.id === selectedId)
        .map((goal) => (
          <section key={goal.id}>
            <div className="inline-fields">
              <label>
                Goal
                <input
                  required
                  value={goal.title}
                  onChange={(e) => updateGoal(goal.id, { title: e.target.value })}
                />
              </label>
              <label>
                Priority, 5 is highest
                <select
                  value={goal.priority}
                  onChange={(e) => updateGoal(goal.id, { priority: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Goal deadline
                <input
                  type="date"
                  value={goal.deadline || ''}
                  onChange={(e) => updateGoal(goal.id, { deadline: e.target.value || null })}
                />
              </label>
              <label>
                Preferred time per day, minutes
                <MinutesInput
                  min={5}
                  max={720}
                  value={goal.preferredDailyMinutes ?? null}
                  placeholder="Optional"
                  onChange={(value) => updateGoal(goal.id, { preferredDailyMinutes: value })}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  onDirty(true)
                  setSelectedId(goals[selectedIndex + 1]?.id || goals[selectedIndex - 1]?.id)
                  setGoals((old) => old.filter((item) => item.id !== goal.id))
                  setTasks((old) => old.filter((task) => task.goalId !== goal.id))
                }}
              >
                Remove goal
              </button>
            </div>
            <label>
              What matters about this goal?
              <textarea
                maxLength={2000}
                placeholder="Optional context, constraints, or what success looks like"
                value={goal.notes || ''}
                onChange={(e) => updateGoal(goal.id, { notes: e.target.value })}
              />
            </label>
            <label>
              Notes about the daily time target, optional
              <input
                maxLength={500}
                placeholder="For example, longer sessions on weekends"
                value={goal.preferredDailyNote || ''}
                onChange={(e) => updateGoal(goal.id, { preferredDailyNote: e.target.value })}
              />
            </label>
            <h3>Subtasks</h3>
            <p className="muted">
              Task estimate means total effort for that task. Leave it blank if unsure. dAIly
              suggests how much to do in each focus block.
            </p>
            {sorted(goal.id).map((task) => (
              <div className="row" key={task.id}>
                <div className="inline-fields row-main">
                  <label>
                    Task
                    <input
                      required
                      value={task.title}
                      onChange={(e) => updateTask(task.id, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    Estimated total minutes
                    <MinutesInput
                      min={5}
                      max={100000}
                      value={task.estimateMinutes ?? null}
                      placeholder="Not sure"
                      onChange={(value) => updateTask(task.id, { estimateMinutes: value })}
                    />
                  </label>
                  <label>
                    Target date
                    <input
                      type="date"
                      value={task.deadline || ''}
                      onChange={(e) => updateTask(task.id, { deadline: e.target.value || null })}
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      onChange={(e) =>
                        updateTask(task.id, { status: e.target.checked ? 'done' : 'todo' })
                      }
                    />
                    Done
                  </label>
                </div>
                <button
                  type="button"
                  aria-label={'Remove ' + (task.title || 'task')}
                  onClick={() => {
                    onDirty(true)
                    setTasks((old) => old.filter((item) => item.id !== task.id))
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  onDirty(true)
                  setTasks((old) => [
                    ...old,
                    {
                      id: crypto.randomUUID(),
                      goalId: goal.id,
                      title: '',
                      estimateMinutes: null,
                      deadline: null,
                      status: 'todo',
                    },
                  ])
                }}
              >
                Add sub tasks
              </button>
              <button type="button" onClick={() => navigate('Today')}>
                Plan my day with this goal
              </button>
            </div>
            <GoalDiscussion
              key={goal.id}
              goal={goal}
              tasks={sorted(goal.id)}
              state={state}
              save={saveDraft}
              onSaved={acceptSaved}
            />
          </section>
        ))}
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save goals'}
        </button>
      </div>
    </form>
  )
}
