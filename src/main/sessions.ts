import { randomUUID } from 'node:crypto'
import type { FocusSession, Snapshot } from '../shared/state'
import type { SessionAction } from '../shared/session'
import { availableIntervals } from './scheduler'
import type { Store } from './store'

export function elapsed(session: FocusSession, now: number): number {
  return session.elapsedSeconds + (session.state === 'running' && session.segmentStartedAt ? Math.max(0, (now - Date.parse(session.segmentStartedAt)) / 1000) : 0)
}
export class Sessions {
  constructor(private store: Store, private clock = Date.now) {}
  active(): FocusSession | undefined { return this.store.snapshot().sessions.find(s => s.state !== 'finished') }
  recover(): void {
    const active = this.active()
    if (active?.state === 'running') this.store.put('sessions', { ...active, state: 'paused', segmentStartedAt: null, needsReconciliation: true })
  }
  suspend(uncertain = true): void {
    const active = this.active()
    if (active?.state === 'running') this.store.put('sessions', { ...active, state: 'paused', elapsedSeconds: Math.floor(elapsed(active, this.clock())), segmentStartedAt: null, needsReconciliation: uncertain })
  }
  tick(): FocusSession | undefined {
    const active = this.active(), now = this.clock()
    if (active?.state === 'running' && elapsed(active, now) >= active.targetMinutes * 60) {
      const expired: FocusSession = { ...active, state: 'awaiting-outcome', elapsedSeconds: active.targetMinutes * 60, segmentStartedAt: null }
      this.store.put('sessions', expired); return expired
    }
    return undefined
  }
  act(command: SessionAction): Snapshot {
    const state = this.store.snapshot(), now = this.clock(), iso = new Date(now).toISOString()
    const active = this.active()
    if (command.action === 'start') {
      if (active?.blockId === command.blockId) return state
      if (active) throw new Error('Finish the current session before starting another.')
      const plan = [...state.plans].reverse().find(p => p.status === 'accepted')
      const block = plan?.blocks.find(b => b.id === command.blockId && b.kind === 'focus')
      const task = state.tasks.find(t => t.id === block?.taskId && t.status === 'todo')
      if (!block || !task || state.sessions.some(s => s.blockId === block.id)) throw new Error('Choose an unfinished block from your accepted plan.')
      const minutes = Math.round((Date.parse(block.end) - Date.parse(block.start)) / 60000)
      if (now < Date.parse(block.start) - 60000) throw new Error('This block starts later. Update your plan if you want to start now.')
      if (!availableIntervals(state, now).some(i => i.start <= now && i.end >= now + minutes * 60000)) throw new Error('This session no longer fits your availability. Update your plan.')
      if (now > Date.parse(block.end)) throw new Error('This block has passed. Ask for a fresh plan.')
      this.store.put('sessions', { id: randomUUID(), taskId: task.id, blockId: block.id, startedAt: iso, segmentStartedAt: iso, targetMinutes: minutes, elapsedSeconds: 0, state: 'running', outcome: null, work: '', interruption: '', finishedAt: null, needsReconciliation: false })
      return this.store.snapshot()
    }
    const session = state.sessions.find(s => s.id === command.id)
    if (!session) throw new Error('Session not found.')
    if (session.state === 'finished') return state
    let next = { ...session }
    if (command.action === 'pause' && session.state === 'running') next = { ...next, state: 'paused', elapsedSeconds: Math.floor(elapsed(session, now)), segmentStartedAt: null }
    if (command.action === 'resume' && session.state === 'paused') {
      if (session.needsReconciliation) throw new Error('Confirm your actual focus time before resuming.')
      const remaining = Math.max(0, session.targetMinutes * 60 - session.elapsedSeconds)
      if (!availableIntervals(state, now).some(i => i.start <= now && i.end >= now + remaining * 1000)) throw new Error('The remaining session no longer fits. Finish early and update your plan.')
      next = { ...next, state: remaining === 0 ? 'awaiting-outcome' : 'running', segmentStartedAt: remaining === 0 ? null : iso }
    }
    if (command.action === 'finish' || command.action === 'stop') next = { ...next, state: 'awaiting-outcome', elapsedSeconds: Math.floor(elapsed(session, now)), segmentStartedAt: null }
    if (command.action === 'reconcile') {
      if (!session.needsReconciliation) return state
      next = { ...next, elapsedSeconds: command.elapsedSeconds, needsReconciliation: false, state: command.elapsedSeconds >= session.targetMinutes * 60 ? 'awaiting-outcome' : 'paused' }
    }
    if (command.action === 'outcome') next = { ...next, state: 'finished', segmentStartedAt: null, elapsedSeconds: command.elapsedSeconds, outcome: command.outcome, work: command.work, interruption: command.interruption, finishedAt: iso, needsReconciliation: false }
    this.store.db.transaction(() => {
      this.store.put('sessions', next)
      if (command.action === 'outcome' && command.outcome === 'completed') {
        const task = state.tasks.find(t => t.id === session.taskId)
        if (task) this.store.put('tasks', { ...task, status: 'done' })
      }
    })()
    return this.store.snapshot()
  }
}
