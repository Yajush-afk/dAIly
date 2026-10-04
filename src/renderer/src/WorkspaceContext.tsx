import { createContext, useContext, useRef, useState } from 'react'
import type { GoalConversationDraft } from './GoalDiscussion'
import type { ReactNode } from 'react'
import type { Snapshot } from '../../shared/state'
import type { MentorResult } from '../../shared/planner'
import type { DayUpdate, WorkflowResult } from '../../shared/workflow'

export const friendlyError = (reason: unknown): string =>
  String(reason)
    .replace(/^Error:\s*/, '')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
export function useConversationController(state: Snapshot) {
  const [mode, setMode] = useState<'day' | 'goal'>('day')
  const [goalId, setGoalId] = useState<string>()
  const [open, setOpen] = useState(localStorage.getItem('daily-conversation-collapsed') !== 'true')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [goalDrafts, setGoalDrafts] = useState<Record<string, GoalConversationDraft>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MentorResult>()
  const planning = useRef(false)
  const inFlight = useRef(false)
  const [changes, setChanges] = useState<
    { goalId: string; title: string; estimateMinutes: number }[]
  >([])
  const receive = (response: WorkflowResult): void => {
    setResult(response.result)
    setError(response.planningError || '')
    if (response.result?.decision.kind === 'propose_changes')
      setChanges(response.result.decision.tasks)
  }
  async function request(update?: DayUpdate): Promise<void> {
    if (!window.dAIly || inFlight.current || busy || (!update && !note.trim())) return
    inFlight.current = true
    setBusy(true)
    setError('')
    toggle(true)
    setMode('day')
    try {
      if (update) {
        planning.current = true
        receive(await window.dAIly.checkInAndPlan(update))
      } else {
        const answer = await window.dAIly.askMentor(
          note.trim(),
          planning.current ? 'plan' : 'conversation',
        )
        setResult(answer)
        if (answer.decision.kind === 'propose_changes') setChanges(answer.decision.tasks)
      }
      setNote('')
    } catch (reason) {
      setError(friendlyError(reason))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  function discuss(id: string): void {
    setGoalId(id)
    setMode('goal')
    toggle(true)
  }
  function toggle(value: boolean): void {
    if (window.matchMedia?.('(min-width: 1180px)').matches ?? window.innerWidth >= 1180) {
      setOpen(value)
      localStorage.setItem('daily-conversation-collapsed', String(!value))
    } else setDrawerOpen(value)
  }
  return {
    state,
    goalDrafts,
    setGoalDrafts,
    mode,
    setMode,
    goalId,
    setGoalId,
    open,
    drawerOpen,
    setOpen: toggle,
    discuss,
    note,
    setNote,
    busy,
    setBusy,
    error,
    setError,
    result,
    changes,
    setChanges,
    request,
    receive,
  }
}
type Conversation = ReturnType<typeof useConversationController>
const Context = createContext<Conversation | null>(null)
export function WorkspaceProvider({
  value,
  children,
}: {
  value: Conversation
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useWorkspace(): Conversation {
  const context = useContext(Context)
  if (!context) throw new Error('Workspace provider is missing')
  return context
}
