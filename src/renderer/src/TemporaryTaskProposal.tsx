import { useRef, useState } from 'react'
import { z } from 'zod'
import { TemporaryTaskDecisionSchema, type TemporaryTaskDraft } from '../../shared/temporary-tasks'
import { useWorkspace, friendlyError } from './WorkspaceContext'
import { useClock } from './useClock'
import { MinutesInput } from './Inputs'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'

export function TemporaryTaskProposal() {
  const workspace = useWorkspace(),
    now = useClock()
  const saved = [...workspace.state.messages]
    .reverse()
    .find((message) => message.role === 'mentor' && message.details?.type === 'decision')
  let pending: { id: string; decision: z.infer<typeof TemporaryTaskDecisionSchema> } | undefined
  if (saved?.details) {
    try {
      const parsed = z
        .object({ decision: TemporaryTaskDecisionSchema, inputRevision: z.number().int() })
        .safeParse(JSON.parse(saved.details.payload))
      const applied = workspace.state.messages.some(
        (message) =>
          message.details?.type === 'changes-accept' &&
          JSON.parse(message.details.payload).decisionId === saved.id,
      )
      if (
        parsed.success &&
        !applied &&
        parsed.data.inputRevision === workspace.state.planningRevision &&
        Date.parse(parsed.data.decision.until) > now
      )
        pending = { id: saved.id, decision: parsed.data.decision }
    } catch {
      /* An unrelated or malformed audit record is not a task proposal. */
    }
  }
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  if (!pending) return null
  const pendingId = pending.id
  const tasks = workspace.temporaryDrafts[pendingId] || pending.decision.tasks
  function setTasks(
    update: TemporaryTaskDraft[] | ((old: TemporaryTaskDraft[]) => TemporaryTaskDraft[]),
  ) {
    workspace.setTemporaryDrafts((old) => ({
      ...old,
      [pendingId]: typeof update === 'function' ? update(old[pendingId] || tasks) : update,
    }))
  }
  const valid =
    tasks.length > 0 &&
    tasks.every(
      (task) => task.title.trim() && task.estimateMinutes !== null && task.estimateMinutes >= 5,
    )
  async function review(action: 'accept' | 'dismiss') {
    if (!window.dAIly || !pending || inFlight.current || workspace.busy) return
    inFlight.current = true
    setSaving(true)
    workspace.setBusy(true)
    workspace.setError('')
    try {
      const response = await window.dAIly.reviewTemporaryTasks({
        decisionId: pending.id,
        action,
        tasks:
          action === 'dismiss'
            ? []
            : tasks.map((task) => ({ ...task, estimateMinutes: task.estimateMinutes! })),
      })
      workspace.receive(response)
    } catch (error) {
      workspace.setError(friendlyError(error))
    } finally {
      inFlight.current = false
      setSaving(false)
      workspace.setBusy(false)
    }
  }
  return (
    <section className="task-change-proposal">
      <h3>Temporary work for this plan</h3>
      <p>Review this work before dAIly adjusts your schedule. It stays out of Goals.</p>
      {tasks.map((task, index) => (
        <div className="dialog-form" key={index}>
          <label>
            Task
            <Input
              value={task.title}
              maxLength={500}
              onChange={(event) =>
                setTasks((old) =>
                  old.map((item, n) =>
                    n === index ? { ...item, title: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <label>
            Estimated total effort, minutes
            <MinutesInput
              value={task.estimateMinutes}
              max={720}
              placeholder="How long will it take?"
              onChange={(estimateMinutes) =>
                setTasks((old) =>
                  old.map((item, n) => (n === index ? { ...item, estimateMinutes } : item)),
                )
              }
            />
          </label>
          <label>
            Due date, optional
            <Input
              type="date"
              value={task.deadline || ''}
              onChange={(event) =>
                setTasks((old) =>
                  old.map((item, n) =>
                    n === index ? { ...item, deadline: event.target.value || null } : item,
                  ),
                )
              }
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setTasks((old) => old.filter((_, n) => n !== index))}
          >
            Remove from suggestion
          </Button>
        </div>
      ))}
      <div className="actions">
        <Button disabled={!valid || saving || workspace.busy} onClick={() => void review('accept')}>
          Add to plan and review schedule
        </Button>
        <Button
          variant="outline"
          disabled={saving || workspace.busy}
          onClick={() => void review('dismiss')}
        >
          Skip this work
        </Button>
      </div>
    </section>
  )
}
