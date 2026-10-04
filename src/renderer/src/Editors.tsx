import { useState } from 'react'
import type { Config, Goal, Profile, Snapshot, Task, TimetableEntry } from '../../shared/state'

export function configFrom(state: Snapshot): Config {
  return {
    profile: state.profile,
    goals: state.goals,
    tasks: state.tasks,
    timetable: state.timetable,
  }
}

export function ProfileEditor({
  state,
  save,
  busy,
}: {
  state: Snapshot
  save: (config: Config) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const [profile, setProfile] = useState<Profile>(state.profile)
  const [timetable, setTimetable] = useState<TimetableEntry[]>(state.timetable)
  const [entry, setEntry] = useState({
    title: 'College',
    weekday: 1,
    date: '',
    start: '09:00',
    end: '17:00',
    cancelled: false,
  })
  const field = <K extends keyof Profile>(key: K, value: Profile[K]): void =>
    setProfile((old) => ({ ...old, [key]: value }))
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save({
          ...configFrom(state),
          profile: { ...profile, onboardingComplete: true },
          timetable,
        })
      }}
    >
      <h2>{state.profile.onboardingComplete ? 'Your day' : 'Set up your day'}</h2>
      <p className="notice">These are starting values. Change them to match your actual routine.</p>
      <div className="form-grid">
        <label>
          Name
          <input required value={profile.name} onChange={(e) => field('name', e.target.value)} />
        </label>
        <label>
          Timezone
          <input
            required
            value={profile.timezone}
            onChange={(e) => field('timezone', e.target.value)}
          />
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
            onChange={(e) => field('commuteMinutes', Number(e.target.value))}
          />
        </label>
        <label>
          Focus block, minutes
          <input
            type="number"
            min="5"
            max="120"
            value={profile.focusMinutes}
            onChange={(e) => field('focusMinutes', Number(e.target.value))}
          />
        </label>
        <label>
          Break, minutes
          <input
            type="number"
            min="5"
            max="60"
            value={profile.breakMinutes}
            onChange={(e) => field('breakMinutes', Number(e.target.value))}
          />
        </label>
      </div>
      <section>
        <h2>College schedule</h2>
        <p className="notice">
          Add weekly classes, or use a date to replace that day's weekly schedule. A cancelled dated
          entry marks a day off.
        </p>
        {timetable.map((item) => (
          <div className="row" key={item.id}>
            <div className="row-main">
              <h3>{item.title}</h3>
              <p>
                {item.date ||
                  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                    item.weekday
                  ]}{' '}
                · {item.cancelled ? 'Day off' : `${item.start} to ${item.end}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEntry({ ...item, date: item.date || '' })
                setTimetable((old) => old.filter((value) => value.id !== item.id))
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setTimetable((old) => old.filter((value) => value.id !== item.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="inline-fields">
          <label>
            Class
            <input
              value={entry.title}
              onChange={(e) => setEntry({ ...entry, title: e.target.value })}
            />
          </label>
          <label>
            Weekday
            <select
              value={entry.weekday}
              onChange={(e) => setEntry({ ...entry, weekday: Number(e.target.value) })}
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (day, i) => (
                  <option value={i} key={day}>
                    {day}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Specific date
            <input
              type="date"
              value={entry.date}
              onChange={(e) => setEntry({ ...entry, date: e.target.value })}
            />
          </label>
          <label>
            Starts
            <input
              type="time"
              value={entry.start}
              onChange={(e) => setEntry({ ...entry, start: e.target.value })}
            />
          </label>
          <label>
            Ends
            <input
              type="time"
              value={entry.end}
              onChange={(e) => setEntry({ ...entry, end: e.target.value })}
            />
          </label>
        </div>
        <div className="actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={entry.cancelled}
              onChange={(e) => setEntry({ ...entry, cancelled: e.target.checked })}
            />
            Day off
          </label>
          <button
            type="button"
            disabled={!entry.title.trim() || (!entry.cancelled && entry.end <= entry.start)}
            onClick={() =>
              setTimetable((old) => [
                ...old,
                { ...entry, date: entry.date || null, id: crypto.randomUUID() },
              ])
            }
          >
            Add to schedule
          </button>
        </div>
      </section>
      <section>
        <h2>Check-ins and quiet hours</h2>
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
        <div className="form-grid">
          <label>
            Quiet hours start
            <input
              type="time"
              value={profile.quietStart}
              onChange={(e) => field('quietStart', e.target.value)}
            />
          </label>
          <label>
            Quiet hours end
            <input
              type="time"
              value={profile.quietEnd}
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
          {busy ? 'Saving...' : 'Save preferences'}
        </button>
      </div>
    </form>
  )
}

export function GoalsEditor({
  state,
  save,
  busy,
}: {
  state: Snapshot
  save: (config: Config) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const [goals, setGoals] = useState<Goal[]>(state.goals)
  const [tasks, setTasks] = useState<Task[]>(state.tasks)
  const [title, setTitle] = useState('')
  const updateGoal = (id: string, patch: Partial<Goal>): void =>
    setGoals((old) => old.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)))
  const updateTask = (id: string, patch: Partial<Task>): void =>
    setTasks((old) => old.map((task) => (task.id === id ? { ...task, ...patch } : task)))
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save({ ...configFrom(state), goals, tasks })
      }}
    >
      <p className="notice">
        Start with a few goals. Give each one a concrete next step. Priority 1 is the most
        important.
      </p>
      {goals.map((goal) => (
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
              Priority
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
            <button
              type="button"
              onClick={() => {
                setGoals((old) => old.filter((item) => item.id !== goal.id))
                setTasks((old) => old.filter((task) => task.goalId !== goal.id))
              }}
            >
              Remove goal
            </button>
          </div>
          {tasks
            .filter((task) => task.goalId === goal.id)
            .map((task) => (
              <div className="row" key={task.id}>
                <div className="inline-fields row-main">
                  <label>
                    Next task
                    <input
                      required
                      value={task.title}
                      onChange={(e) => updateTask(task.id, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    Minutes
                    <input
                      type="number"
                      min="5"
                      max="480"
                      value={task.estimateMinutes}
                      onChange={(e) =>
                        updateTask(task.id, { estimateMinutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Task deadline
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
                  aria-label={`Remove ${task.title || 'task'}`}
                  onClick={() => setTasks((old) => old.filter((item) => item.id !== task.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          <button
            type="button"
            onClick={() =>
              setTasks((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  goalId: goal.id,
                  title: '',
                  estimateMinutes: state.profile.focusMinutes,
                  deadline: null,
                  status: 'todo',
                },
              ])
            }
          >
            Add next step
          </button>
        </section>
      ))}
      <div className="inline-fields">
        <label>
          New goal
          <input
            placeholder="DSA, an exam, or something else"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!title.trim()}
          onClick={() => {
            setGoals((old) => [
              ...old,
              { id: crypto.randomUUID(), title: title.trim(), priority: 3, deadline: null },
            ])
            setTitle('')
          }}
        >
          Add goal
        </button>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save goals'}
        </button>
      </div>
    </form>
  )
}
