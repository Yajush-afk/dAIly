import { Button } from './components/ui/button'
import { useState, type Dispatch, type SetStateAction } from 'react'
import type { Goal, Snapshot, Task } from '../../shared/state'
import { GoalDecisionSchema, type GoalDiscussionResult } from '../../shared/goal-mentor'
import { sendChatOnEnter } from './Inputs'

const readableError = (reason: unknown): string =>
  String(reason)
    .replace(/^Error:\s*/, '')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

export interface GoalConversationDraft {
  text: string
  proposal?: GoalDiscussionResult
  tasks: {
    id: string | null
    title: string
    deadline: string | null
    estimateMinutes: number | null
  }[]
}
export function GoalDiscussion({
  goal,
  tasks,
  state,
  save,
  onSaved,
  externalBusy = false,
  onPending,
  draft,
  onDraftChange,
}: {
  goal: Goal
  tasks: Task[]
  state: Snapshot
  save: () => Promise<boolean>
  externalBusy?: boolean
  onPending?: (busy: boolean) => void
  draft?: GoalConversationDraft
  onDraftChange?: (draft: GoalConversationDraft) => void
  onSaved: (state: Snapshot) => void
}): React.JSX.Element {
  const messages = state.messages.filter(
    (message) => message.channel === 'goal' && message.goalId === goal.id,
  )
  const conversation = messages.filter((message) => message.details?.type !== 'changes-accept')
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
  const [localText, setLocalText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [localProposal, setLocalProposal] = useState<GoalDiscussionResult | undefined>(restored)
  const [localTasks, setLocalTasks] = useState<GoalConversationDraft['tasks']>(
    restored?.decision.kind === 'roadmap' ? restored.decision.tasks : [],
  )
  const text = draft ? draft.text : localText
  const proposal = draft ? draft.proposal : localProposal
  const tasksDraft = draft ? draft.tasks : localTasks
  const setText = (next: string): void => {
    if (onDraftChange) onDraftChange({ text: next, proposal, tasks: tasksDraft })
    else setLocalText(next)
  }
  const setProposal: Dispatch<SetStateAction<GoalDiscussionResult | undefined>> = (next) => {
    const value = typeof next === 'function' ? next(proposal) : next
    if (onDraftChange)
      onDraftChange({
        text,
        proposal: value,
        tasks:
          value?.decision.kind === 'roadmap' && value.decisionId !== proposal?.decisionId
            ? value.decision.tasks
            : tasksDraft,
      })
    else setLocalProposal(value)
  }
  const setTasksDraft: Dispatch<SetStateAction<GoalConversationDraft['tasks']>> = (next) => {
    const value = typeof next === 'function' ? next(tasksDraft) : next
    if (onDraftChange) onDraftChange({ text, proposal, tasks: value })
    else setLocalTasks(value)
  }
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
    if (!text.trim() || !window.dAIly || pending || externalBusy) return
    setPending(true)
    onPending?.(true)
    setError('')
    setSaved(false)
    try {
      if (!(await save())) return
      const result = await window.dAIly.discussGoal({ goalId: goal.id, text: text.trim() })
      if (onDraftChange)
        onDraftChange({
          text: '',
          proposal: result,
          tasks: result.decision.kind === 'roadmap' ? result.decision.tasks : [],
        })
      else {
        setLocalProposal(result)
        if (result.decision.kind === 'roadmap') setLocalTasks(result.decision.tasks)
        setLocalText('')
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setPending(false)
      onPending?.(false)
    }
  }
  async function approve(): Promise<void> {
    if (
      !proposal ||
      proposal.decision.kind !== 'roadmap' ||
      !window.dAIly ||
      pending ||
      externalBusy
    )
      return
    setPending(true)
    onPending?.(true)
    setError('')
    setSaved(false)
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
      setSaved(true)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setPending(false)
      onPending?.(false)
    }
  }
  return (
    <section className="goal-discussion" aria-label={'Discuss goal: ' + goal.title}>
      <div className="goal-thread-content">
        <h3>Discuss this goal with dAIly</h3>
        <p className="muted">
          Talk through the outcome, effort, and deadlines. This goal currently has{' '}
          {tasks.filter((task) => task.status === 'todo').length} unfinished steps. Review a
          proposed roadmap before saving it.
        </p>
        <div className="conversation goal-conversation" aria-live="polite">
          {conversation.slice(-8).map((message) => (
            <article key={message.id}>
              <strong>{message.role === 'user' ? state.profile.name : 'dAIly'}</strong>
              <p>{message.text}</p>
            </article>
          ))}
          {!conversation.length && (
            <p className="muted">Start with what you want to achieve and what you already know.</p>
          )}
        </div>
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
            <Button
              type="button"
              onClick={() =>
                setTasksDraft((old) => [
                  ...old,
                  { id: null, title: '', deadline: null, estimateMinutes: null },
                ])
              }
            >
              Add a task
            </Button>
            <Button
              type="button"
              disabled={
                pending || !tasksDraft.length || tasksDraft.some((item) => !item.title.trim())
              }
              onClick={() => void approve()}
            >
              {pending ? 'Applying…' : 'Apply roadmap to goal'}
            </Button>
          </div>
        )}
        {saved && <p role="status">Roadmap applied to this goal and its sub tasks.</p>}
        {proposal?.decision.kind === 'discuss' && (
          <p className="notice">{proposal.decision.explanation}</p>
        )}
      </div>
      <div className="goal-composer">
        <label>
          Your message
          <textarea
            value={text}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => sendChatOnEnter(event, () => void send())}
            placeholder="I want to prepare for interviews. How should I divide the topics?"
          />
        </label>
        <p className="muted">
          <small>Enter to send. Shift+Enter for a new line.</small>
        </p>
        <Button
          type="button"
          disabled={pending || externalBusy || !text.trim()}
          onClick={() => void send()}
        >
          {pending ? 'Thinking…' : 'Send'}
        </Button>
        {pending && (
          <Button type="button" onClick={() => void window.dAIly?.cancelModel()}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  )
}
