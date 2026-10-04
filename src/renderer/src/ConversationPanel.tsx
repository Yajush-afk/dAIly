import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Flag, CalendarDays } from 'lucide-react'
import type { Snapshot } from '../../shared/state'
import { useWorkspace, friendlyError } from './WorkspaceContext'
import { TemporaryTaskProposal } from './TemporaryTaskProposal'
import { GoalDiscussion } from './GoalDiscussion'
import { PlanProposal } from './TodayDashboard'
import { Button } from './components/ui/button'
import { Textarea } from './components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import { sendChatOnEnter } from './Inputs'
export function ConversationMessages({ state }: { state: Snapshot }) {
  const ref = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    [newMessages, setNewMessages] = useState(false)
  const messages = state.messages.filter(
    (m) => m.channel !== 'goal' && (!m.details || m.details.type === 'decision'),
  )
  const lastId = messages.at(-1)?.id
  useEffect(() => {
    if (nearBottom.current)
      ref.current?.scrollTo?.({ top: ref.current.scrollHeight, behavior: 'smooth' })
    else setNewMessages(true)
  }, [lastId])
  return (
    <div className="message-region">
      <div
        className="conversation-messages"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
          if (nearBottom.current) setNewMessages(false)
        }}
      >
        {messages.map((m) => (
          <article key={m.id} className={m.role === 'user' ? 'user-message' : 'assistant-message'}>
            <strong>{m.role === 'user' ? state.profile.name : 'dAIly'}</strong>
            <p>{m.text}</p>
          </article>
        ))}
        {!messages.length && (
          <div className="conversation-welcome">
            <CalendarDays size={20} />
            <h3>A little clarity for your day.</h3>
            <p>Tell me what changed, ask about your plan, or check in to choose your next step.</p>
          </div>
        )}
      </div>
      {newMessages && (
        <Button
          variant="outline"
          size="sm"
          className="new-messages"
          onClick={() => {
            ref.current?.scrollTo?.({ top: ref.current.scrollHeight, behavior: 'smooth' })
            nearBottom.current = true
            setNewMessages(false)
          }}
        >
          <ArrowDown />
          New messages
        </Button>
      )}
    </div>
  )
}
export function ConversationComposer() {
  const workspace = useWorkspace()
  return (
    <div className="conversation-composer">
      <label className="sr-only" htmlFor="daily-message">
        Your message
      </label>
      <Textarea
        id="daily-message"
        value={workspace.note}
        maxLength={4000}
        onChange={(e) => workspace.setNote(e.target.value)}
        onKeyDown={(e) =>
          sendChatOnEnter(e, () => {
            if (!workspace.busy) void workspace.request()
          })
        }
        placeholder="Tell dAIly what’s on your mind…"
      />
      <div>
        <span>Shift+Enter for a new line</span>
        <Button
          size="icon"
          aria-label="Send"
          disabled={workspace.busy || !workspace.note.trim()}
          onClick={() => void workspace.request()}
        >
          <ArrowUp size={17} />
        </Button>
      </div>
    </div>
  )
}
export function TaskChangeProposal() {
  const workspace = useWorkspace(),
    result = workspace.result
  const [saving, setSaving] = useState(false)
  if (result?.decision.kind !== 'propose_changes' || !result.decisionId) return null
  return (
    <section className="task-change-proposal">
      <h3>Review task changes</h3>
      <p>{result.decision.explanation}</p>
      {workspace.changes.map((task, i) => (
        <div className="dialog-form" key={i}>
          <label>
            Goal
            <select
              value={task.goalId}
              onChange={(e) =>
                workspace.setChanges(
                  workspace.changes.map((t, n) => (n === i ? { ...t, goalId: e.target.value } : t)),
                )
              }
            >
              {workspace.state.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sub task
            <input
              value={task.title}
              onChange={(e) =>
                workspace.setChanges(
                  workspace.changes.map((t, n) => (n === i ? { ...t, title: e.target.value } : t)),
                )
              }
            />
          </label>
          <label>
            Estimated total effort, minutes
            <input
              type="number"
              min={5}
              max={100000}
              value={task.estimateMinutes}
              onChange={(e) =>
                workspace.setChanges(
                  workspace.changes.map((t, n) =>
                    n === i ? { ...t, estimateMinutes: Number(e.target.value) } : t,
                  ),
                )
              }
            />
          </label>
        </div>
      ))}
      <Button
        disabled={saving}
        onClick={async () => {
          if (!window.dAIly || !result.decisionId || saving) return
          setSaving(true)
          try {
            await window.dAIly.approveChanges({
              decisionId: result.decisionId,
              tasks: workspace.changes,
            })
            workspace.receive({ state: workspace.state })
          } catch (reason) {
            workspace.setError(friendlyError(reason))
          } finally {
            setSaving(false)
          }
        }}
      >
        Apply task changes
      </Button>
    </section>
  )
}
export function ConversationPanel({
  onSaved,
  settings,
}: {
  onSaved: (state: Snapshot) => void
  settings: () => void
}) {
  const workspace = useWorkspace(),
    state = workspace.state
  const selected = state.goals.find((g) => g.id === workspace.goalId) || state.goals[0]
  const proposal = state.plans.find(
    (p) => p.id === workspace.result?.planId && p.status === 'proposed',
  )
  return (
    <div className="conversation-panel">
      <div className="conversation-mode">
        <Select
          value={workspace.mode}
          onValueChange={(value) => workspace.setMode(value as 'day' | 'goal')}
        >
          <SelectTrigger aria-label="Conversation mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Your day</SelectItem>
            <SelectItem value="goal">Discuss a goal</SelectItem>
          </SelectContent>
        </Select>
        {workspace.mode === 'goal' && (
          <Select value={selected?.id || ''} onValueChange={workspace.setGoalId}>
            <SelectTrigger aria-label="Goal to discuss">
              <SelectValue placeholder="Choose a goal" />
            </SelectTrigger>
            <SelectContent>
              {state.goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="day-conversation" hidden={workspace.mode !== 'day'}>
        <ConversationMessages state={state} />
        <div className="conversation-proposals">
          {proposal && <PlanProposal plan={proposal} state={state} />}
          <TemporaryTaskProposal />
          <TaskChangeProposal />
        </div>
        {workspace.busy && (
          <div role="status" className="thinking-status">
            Thinking through your day…
            <Button variant="ghost" size="sm" onClick={() => void window.dAIly?.cancelModel()}>
              Cancel
            </Button>
          </div>
        )}
        {workspace.error && (
          <div role="alert" className="conversation-error">
            <p>{workspace.error}</p>
            <Button variant="outline" size="sm" onClick={() => void workspace.request()}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={settings}>
              Local AI settings
            </Button>
          </div>
        )}
        <ConversationComposer />
      </div>
      <div className="goal-conversation-host" hidden={workspace.mode !== 'goal'}>
        {!selected && (
          <div className="conversation-welcome">
            <Flag size={20} />
            <h3>Start with a goal.</h3>
            <p>Add a goal to discuss its roadmap here.</p>
          </div>
        )}
        {state.goals.map((goal) => (
          <div key={goal.id} hidden={goal.id !== selected?.id}>
            <GoalDiscussion
              goal={goal}
              tasks={state.tasks.filter((t) => t.goalId === goal.id)}
              state={state}
              save={async () => true}
              onSaved={onSaved}
              externalBusy={workspace.busy}
              onPending={workspace.setBusy}
              draft={workspace.goalDrafts[goal.id]}
              onDraftChange={(draft) =>
                workspace.setGoalDrafts((old) => ({ ...old, [goal.id]: draft }))
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}
