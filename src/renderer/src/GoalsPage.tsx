import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Pencil,
  MessageSquare,
  ChevronRight,
  Trash2,
} from 'lucide-react'
import type { Config, Goal, Snapshot, Task } from '../../shared/state'
import { GoalSchema, TaskSchema } from '../../shared/state'
import { configFrom } from './Editors'
import { explicitSubmit, MinutesInput } from './Inputs'
import { useWorkspace, friendlyError } from './WorkspaceContext'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'

export const orderedGoals = (goals: Goal[]): Goal[] =>
  [...goals].sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
      a.title.localeCompare(b.title),
  )
export const orderedTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort(
    (a, b) =>
      (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title),
  )
export function GoalList({ state, select }: { state: Snapshot; select: (id: string) => void }) {
  return (
    <div className="goal-list">
      {orderedGoals(state.goals).map((goal) => (
        <button
          className="goal-list-row"
          aria-label={'Open goal: ' + goal.title}
          key={goal.id}
          onClick={() => select(goal.id)}
        >
          <div>
            <strong>{goal.title}</strong>
            <span>
              {state.tasks.filter((t) => t.goalId === goal.id && t.status === 'todo').length}{' '}
              unfinished sub tasks
              {goal.preferredDailyMinutes
                ? ` · ${goal.preferredDailyMinutes} min preferred daily`
                : ''}
            </span>
          </div>
          <div className="goal-row-meta">
            <span>Priority {goal.priority}</span>
            <span>{goal.deadline || 'No deadline'}</span>
            <ChevronRight size={16} />
          </div>
        </button>
      ))}
    </div>
  )
}
export function GoalFormDialog({
  goal,
  open,
  close,
  save,
}: {
  goal?: Goal
  open: boolean
  close: () => void
  save: (goal: Goal) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<Goal>(
    () =>
      goal || {
        id: crypto.randomUUID(),
        title: '',
        priority: 3,
        deadline: null,
        preferredDailyMinutes: null,
        notes: '',
        preferredDailyNote: '',
      },
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false)
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(
      goal || {
        id: draft.id,
        title: '',
        priority: 3,
        deadline: null,
        preferredDailyMinutes: null,
        notes: '',
        preferredDailyNote: '',
      },
    )
  function requestClose() {
    if (busy) return
    if (dirty) setDiscard(true)
    else close()
  }
  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const parsed = GoalSchema.safeParse(draft)
      if (!parsed.success) {
        setError('Add a goal name and check the dates and daily minutes.')
        return
      }
      if (await save(parsed.data)) close()
    } catch (reason) {
      setError(friendlyError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) requestClose()
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (dirty || busy) {
              event.preventDefault()
              requestClose()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
            <DialogDescription>
              Define the outcome and the time you would like to give it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="dialog-form"
            onKeyDown={explicitSubmit}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <label>
              Goal name
              <Input
                autoFocus
                required
                value={draft.title}
                maxLength={500}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="For example, DSA for interviews"
              />
            </label>
            <label>
              What matters about this goal?
              <Textarea
                value={draft.notes || ''}
                maxLength={2000}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="What does success look like?"
              />
            </label>
            <div className="form-grid">
              <label>
                Priority
                <select
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === 5 ? ' · Highest' : n === 1 ? ' · Lowest' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Goal deadline
                <Input
                  type="date"
                  value={draft.deadline || ''}
                  onChange={(e) => setDraft({ ...draft, deadline: e.target.value || null })}
                />
              </label>
            </div>
            <label>
              Preferred time per day, minutes
              <MinutesInput
                min={5}
                max={720}
                value={draft.preferredDailyMinutes ?? null}
                onChange={(value) => setDraft({ ...draft, preferredDailyMinutes: value })}
                placeholder="Optional"
              />
            </label>
            <p className="field-help">
              A flexible target. Your daily plan can change with deadlines and available time.
            </p>
            <label>
              Notes about the daily time target, optional
              <Input
                value={draft.preferredDailyNote || ''}
                maxLength={500}
                onChange={(e) => setDraft({ ...draft, preferredDailyNote: e.target.value })}
                placeholder="For example, more time on weekends"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
                Cancel
              </Button>
              <Button disabled={busy}>
                {busy ? 'Saving…' : goal ? 'Save goal' : 'Create goal'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
            <AlertDialogDescription>Your saved goal will stay as it is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={close}>Discard edits</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
function SubtaskDialog({
  task,
  goalId,
  close,
  save,
}: {
  task?: Task
  goalId: string
  close: () => void
  save: (task: Task) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<Task>(
    () =>
      task || {
        id: crypto.randomUUID(),
        goalId,
        title: '',
        estimateMinutes: null,
        deadline: null,
        status: 'todo',
      },
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const parsed = TaskSchema.safeParse(draft)
      if (!parsed.success) {
        setError('Add a sub task name and check its estimate and target date.')
        return
      }
      if (await save(parsed.data)) close()
    } catch (reason) {
      setError(friendlyError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? 'Edit sub task' : 'Add sub tasks'}</DialogTitle>
          <DialogDescription>A concrete topic or step toward this goal.</DialogDescription>
        </DialogHeader>
        <form
          className="dialog-form"
          onKeyDown={explicitSubmit}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label>
            Sub task name
            <Input
              autoFocus
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Target date
              <Input
                type="date"
                value={draft.deadline || ''}
                onChange={(e) => setDraft({ ...draft, deadline: e.target.value || null })}
              />
            </label>
            <label>
              Estimated total effort, minutes
              <MinutesInput
                min={5}
                max={100000}
                value={draft.estimateMinutes}
                onChange={(value) => setDraft({ ...draft, estimateMinutes: value })}
                placeholder="Optional"
              />
            </label>
          </div>
          <p className="field-help">
            Total effort for this whole sub task, not a daily allocation. dAIly can help estimate
            it.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? 'Saving…' : 'Save sub task'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export function SubtaskList({ tasks, edit }: { tasks: Task[]; edit: (task: Task) => void }) {
  return (
    <ul className="subtask-list">
      {orderedTasks(tasks).map((task) => (
        <li key={task.id}>
          <button onClick={() => edit(task)}>
            <div>
              <strong>{task.title}</strong>
              <span>
                {task.estimateMinutes
                  ? `${task.estimateMinutes} min estimated total effort`
                  : 'Effort not estimated'}
              </span>
            </div>
            <span>{task.deadline || 'No target date'}</span>
            <Pencil size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
export function GoalsPage({
  state,
  save,
  selectedId,
  select,
}: {
  state: Snapshot
  save: (config: Config) => Promise<boolean>
  selectedId?: string
  select: (id?: string) => void
}) {
  const workspace = useWorkspace(),
    goals = orderedGoals(state.goals),
    goal = goals.find((g) => g.id === selectedId)
  const [editing, setEditing] = useState<Goal | 'new'>(),
    [taskEdit, setTaskEdit] = useState<Task | 'new'>(),
    [deleting, setDeleting] = useState(false)
  const saveGoal = async (next: Goal) =>
    save({
      ...configFrom(state),
      goals: state.goals.some((g) => g.id === next.id)
        ? state.goals.map((g) => (g.id === next.id ? next : g))
        : [...state.goals, next],
    })
  const saveTask = async (next: Task) =>
    save({
      ...configFrom(state),
      tasks: state.tasks.some((t) => t.id === next.id)
        ? state.tasks.map((t) => (t.id === next.id ? next : t))
        : [...state.tasks, next],
    })
  const index = goal ? goals.indexOf(goal) : -1,
    tasks = state.tasks.filter((t) => t.goalId === goal?.id)
  return (
    <div className="goals-page">
      <div className="page-intro">
        <div>
          <h2>{goal ? goal.title : 'Your goals'}</h2>
          <p>
            {goal
              ? 'Your direction, broken into manageable steps.'
              : 'Choose a goal to see its roadmap or talk it through with dAIly.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus />
          New Goal
        </Button>
      </div>
      {goal ? (
        <>
          <div className="goal-toolbar">
            <Button variant="ghost" onClick={() => select(undefined)}>
              <ArrowLeft />
              My Goals
            </Button>
            <div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous goal"
                disabled={index === 0}
                onClick={() => select(goals[index - 1].id)}
              >
                <ArrowLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next goal"
                disabled={index === goals.length - 1}
                onClick={() => select(goals[index + 1].id)}
              >
                <ArrowRight />
              </Button>
              <Button variant="outline" onClick={() => setEditing(goal)}>
                <Pencil />
                Edit goal
              </Button>
            </div>
          </div>
          <section className="goal-overview">
            <p>{goal.notes || 'Add what success means to you through Edit goal.'}</p>
            <dl>
              <div>
                <dt>Priority</dt>
                <dd>{goal.priority} of 5</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>{goal.deadline || 'Not set'}</dd>
              </div>
              <div>
                <dt>Preferred daily time</dt>
                <dd>
                  {goal.preferredDailyMinutes
                    ? `${goal.preferredDailyMinutes} minutes`
                    : 'Flexible'}
                </dd>
              </div>
            </dl>
            {goal.preferredDailyNote && <p className="muted">{goal.preferredDailyNote}</p>}
            <Button onClick={() => workspace.discuss(goal.id)}>
              <MessageSquare />
              Discuss this goal
            </Button>
          </section>
          <section className="dashboard-section">
            <div className="section-heading">
              <h3>Sub tasks</h3>
              <Button variant="outline" size="sm" onClick={() => setTaskEdit('new')}>
                <Plus />
                Add sub tasks
              </Button>
            </div>
            <p className="muted">In order of target date. Estimates refer to the whole sub task.</p>
            <SubtaskList tasks={tasks.filter((t) => t.status === 'todo')} edit={setTaskEdit} />
            {!tasks.some((t) => t.status === 'todo') && (
              <p className="empty-copy">Add a first step or discuss a roadmap with dAIly.</p>
            )}
            <Collapsible>
              <CollapsibleTrigger className="completed-toggle">
                Completed sub tasks ({tasks.filter((t) => t.status === 'done').length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SubtaskList tasks={tasks.filter((t) => t.status === 'done')} edit={setTaskEdit} />
              </CollapsibleContent>
            </Collapsible>
          </section>
          <Button variant="ghost" className="delete-goal" onClick={() => setDeleting(true)}>
            <Trash2 />
            Delete goal
          </Button>
        </>
      ) : (
        <>
          <GoalList state={state} select={select} />
          {!goals.length && (
            <div className="empty-copy">
              <h3>What would you like to work toward?</h3>
              <p>Start with one goal. You can shape the roadmap together with dAIly.</p>
            </div>
          )}
        </>
      )}
      {editing && (
        <GoalFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          goal={editing === 'new' ? undefined : editing}
          open
          close={() => setEditing(undefined)}
          save={async (next) => {
            const ok = await saveGoal(next)
            if (ok) select(next.id)
            return ok
          }}
        />
      )}
      {taskEdit && goal && (
        <SubtaskDialog
          key={taskEdit === 'new' ? 'new-task' : taskEdit.id}
          task={taskEdit === 'new' ? undefined : taskEdit}
          goalId={goal.id}
          close={() => setTaskEdit(undefined)}
          save={saveTask}
        />
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sub tasks will be removed. Reported focus time remains in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!goal) return
                if (
                  await save({
                    ...configFrom(state),
                    goals: state.goals.filter((g) => g.id !== goal.id),
                    tasks: state.tasks.filter((t) => t.goalId !== goal.id),
                  })
                ) {
                  setDeleting(false)
                  select(undefined)
                }
              }}
            >
              Delete goal
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
