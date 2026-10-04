import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Goal } from '../../shared/state'
import { explicitSubmit, MinutesInput } from './Inputs'

export function NewGoalDialog({
  create,
  onClose,
}: {
  create: (goal: Goal) => Promise<boolean>
  onClose: () => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [goal, setGoal] = useState<Goal>({
    id: crypto.randomUUID(),
    title: '',
    priority: 3,
    deadline: null,
    preferredDailyMinutes: null,
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      if (element?.open) element.close()
    }
  }, [])
  return createPortal(
    <dialog
      ref={dialog}
      className="new-goal-dialog"
      aria-labelledby="new-goal-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <form
        onKeyDown={explicitSubmit}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (pending || !goal.title.trim()) return
          setPending(true)
          setError('')
          void create({ ...goal, title: goal.title.trim() })
            .then((saved) => {
              if (!saved)
                setError(
                  'This goal could not be saved. Check your existing goal edits and try again.',
                )
            })
            .catch(() => setError('This goal could not be saved. Please try again.'))
            .finally(() => setPending(false))
        }}
      >
        <h2 id="new-goal-title">New goal</h2>
        <p className="muted">
          Add the goal first, then break it into subtasks and discuss it with dAIly.
        </p>
        <div className="form-grid">
          <label className="wide">
            Goal name
            <input
              autoFocus
              required
              maxLength={200}
              value={goal.title}
              onChange={(event) => setGoal({ ...goal, title: event.target.value })}
            />
          </label>
          <label>
            Priority, 5 is highest
            <select
              value={goal.priority}
              onChange={(event) => setGoal({ ...goal, priority: Number(event.target.value) })}
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
              onChange={(event) => setGoal({ ...goal, deadline: event.target.value || null })}
            />
          </label>
          <label className="wide">
            Preferred time per day, minutes
            <MinutesInput
              min={5}
              max={720}
              value={goal.preferredDailyMinutes ?? null}
              placeholder="Optional"
              onChange={(value) => setGoal((old) => ({ ...old, preferredDailyMinutes: value }))}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="outlined" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={pending || !goal.title.trim()}>
            {pending ? 'Saving…' : 'Create goal'}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  )
}
