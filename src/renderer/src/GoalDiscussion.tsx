import { useState } from 'react'
import type { Goal, Snapshot, Task } from '../../shared/state'
import { GoalDecisionSchema, type GoalDiscussionResult } from '../../shared/goal-mentor'

export function GoalDiscussion({
  goal,
  tasks,
  state,
  save,
  onSaved,
}: {
  goal: Goal
  tasks: Task[]
  state: Snapshot
  save: () => Promise<boolean>
  onSaved: (state: Snapshot) => void
}): React.JSX.Element {
  const messages = state.messages.filter(
    (message) => message.channel === 'goal' && message.goalId === goal.id,
  )
  const lastPending = [...messages]
    .reverse()
    .find((message) => message.role === 'mentor' && message.details?.type === 'goal-decision')
  const restored = (() => {
    try {
      if (
        !lastPending ||
        messages.some(
          (message) =>
            message.role === 'user' &&
            message.details?.type === 'changes-accept' &&
            (JSON.parse(message.details.payload) as { decisionId?: string }).decisionId ===
              lastPending.id,
        )
      )
        return undefined
      const payload = JSON.parse(lastPending.details!.payload) as {
        decision: unknown
        inputRevision: number
      }
      const decision = GoalDecisionSchema.parse(payload.decision)
      return decision.kind === 'roadmap'
        ? {
            decisionId: lastPending.id,
            goalId: goal.id,
            inputRevision: payload.inputRevision,
            decision,
          }
        : undefined
    } catch {
      return undefined
    }
  })()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<GoalDiscussionResult | undefined>(restored)
  const [tasksDraft, setTasksDraft] = useState<
    { id: string | null; title: string; deadline: string | null; estimateMinutes: number | null }[]
  >([])
  function updateRoadmap(
    patch: Partial<Extract<GoalDiscussionResult['decision'], { kind: 'roadmap' }>>,
  ): void {
    setProposal((current) =>
      current?.decision.kind === 'roadmap'
        ? { ...current, decision: { ...current.decision, ...patch } }
        : current,
    )
  }
  async function send(): Promise<void> {
    if (!text.trim() || !window.dAIly || pending) return
    setPending(true)
    setError('')
    try {
      if (!(await save())) return
      const result = await window.dAIly.discussGoal({ goalId: goal.id, text: text.trim() })
      setProposal(result)
      if (result.decision.kind === 'roadmap') setTasksDraft(result.decision.tasks)
      setText('')
    } catch (reason) {
      setError(String(reason))
    } finally {
      setPending(false)
    }
  }
  async function approve(): Promise<void> {
    if (!proposal || proposal.decision.kind !== 'roadmap' || !window.dAIly) return
    setPending(true)
    setError('')
    try {
      const updated = await window.dAIly.approveRoadmap({
        decisionId: proposal.decisionId,
        tasks: tasksDraft,
        priority: proposal.decision.priority,
        preferredDailyMinutes: proposal.decision.preferredDailyMinutes,
        deadline: proposal.decision.deadline,
      })
      onSaved(updated)
      setProposal(undefined)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="goal-discussion" aria-label={'Discuss goal: ' + goal.title}>
      <h3>Discuss this goal with dAIly</h3>
      <p className="muted">
        Talk through the outcome, effort, and deadlines. This goal currently has{' '}
        {tasks.filter((task) => task.status === 'todo').length} unfinished steps. Review a proposed
        roadmap before saving it.
      </p>
      <div className="conversation goal-conversation" aria-live="polite">
        {messages.slice(-8).map((message) => (
          <article key={message.id}>
            <strong>{message.role === 'user' ? state.profile.name : 'dAIly'}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {!messages.length && (
          <p className="muted">Start with what you want to achieve and what you already know.</p>
        )}
      </div>
      <label>
        Your message
        <textarea
          value={text}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
          placeholder="I want to prepare for interviews. How should I divide the topics?"
        />
      </label>
      <button type="button" disabled={pending || !text.trim()} onClick={() => void send()}>
        {pending ? 'Thinking…' : 'Send'}
      </button>
      {pending && (
        <button type="button" onClick={() => void window.dAIly?.cancelModel()}>
          Cancel
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {proposal?.decision.kind === 'roadmap' && (
        <div className="roadmap-review">
          <h3>Review proposed roadmap</h3>
          <p>{proposal.decision.explanation}</p>
          <p className="muted">
            Task estimates are total effort. Deadlines are targets to discuss, not guarantees.
          </p>
          <label>
            Goal priority
            <select
              value={proposal.decision.priority}
              onChange={(event) => updateRoadmap({ priority: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} (5 is highest)
                </option>
              ))}
            </select>
          </label>
          <label>
            Preferred minutes per day
            <input
              type="number"
              min="5"
              max="720"
              value={proposal.decision.preferredDailyMinutes ?? ''}
              onChange={(event) =>
                updateRoadmap({
                  preferredDailyMinutes: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Goal deadline
            <input
              type="date"
              value={proposal.decision.deadline || ''}
              onChange={(event) => updateRoadmap({ deadline: event.target.value || null })}
            />
          </label>
          {tasksDraft.map((task, index) => (
            <div className="inline-fields" key={task.id || 'new-' + index}>
              <label>
                Task
                <input
                  value={task.title}
                  onChange={(event) =>
                    setTasksDraft((old) =>
                      old.map((item, i) =>
                        i === index ? { ...item, title: event.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Target date
                <input
                  type="date"
                  value={task.deadline || ''}
                  onChange={(event) =>
                    setTasksDraft((old) =>
                      old.map((item, i) =>
                        i === index ? { ...item, deadline: event.target.value || null } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Total effort, minutes
                <input
                  type="number"
                  min="5"
                  max="100000"
                  value={task.estimateMinutes ?? ''}
                  placeholder="Not sure"
                  onChange={(event) =>
                    setTasksDraft((old) =>
                      old.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              estimateMinutes: event.target.value
                                ? Number(event.target.value)
                                : null,
                            }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setTasksDraft((old) => [
                ...old,
                { id: null, title: '', deadline: null, estimateMinutes: null },
              ])
            }
          >
            Add a task
          </button>
          <button
            type="button"
            disabled={
              pending || !tasksDraft.length || tasksDraft.some((item) => !item.title.trim())
            }
            onClick={() => void approve()}
          >
            {pending ? 'Saving…' : 'Save this roadmap'}
          </button>
        </div>
      )}
      {proposal?.decision.kind === 'discuss' && (
        <p className="notice">{proposal.decision.explanation}</p>
      )}
    </section>
  )
}
