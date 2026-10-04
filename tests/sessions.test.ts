import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/store'
import { Sessions } from '../src/main/sessions'
import { LocalNotifications, isQuiet } from '../src/main/notifications'
import { defaultProfile } from '../src/shared/state'

function setup(): { store: Store; sessions: Sessions; blockId: string; advance: (ms: number) => void } {
  const store = new Store(':memory:'), goalId = randomUUID(), taskId = randomUUID(), blockId = randomUUID()
  let now = Date.parse('2026-10-04T14:30:00Z')
  store.saveConfig({ profile: { ...defaultProfile, timezone: 'Asia/Kolkata', notifications: true }, goals: [{ id: goalId, title: 'DSA', priority: 2, deadline: null }], tasks: [{ id: taskId, goalId, title: 'Solve a graph problem', status: 'todo', estimateMinutes: 30, deadline: null }], timetable: [] })
  store.put('plans', { id: randomUUID(), createdAt: new Date(now).toISOString(), contextRevision: store.revision, status: 'accepted', summary: 'One useful step', blocks: [{ id: blockId, taskId, title: 'Solve a graph problem', kind: 'focus', start: new Date(now).toISOString(), end: new Date(now + 1800000).toISOString(), reason: 'Time available' }], deferred: [] })
  return { store, sessions: new Sessions(store, () => now), blockId, advance: ms => { now += ms } }
}
describe('focus sessions', () => {
  it('expires into an outcome request without manufacturing completed work', () => {
    const { store, sessions, blockId, advance } = setup()
    sessions.act({ action: 'start', blockId }); sessions.act({ action: 'start', blockId })
    expect(store.snapshot().sessions).toHaveLength(1)
    advance(1800000); expect(sessions.tick()?.state).toBe('awaiting-outcome')
    expect(store.snapshot().tasks[0].status).toBe('todo')
    expect(sessions.tick()).toBeUndefined(); store.close()
  })
  it('counts running segments, excludes pauses, and records explicit completion once', () => {
    const { store, sessions, blockId, advance } = setup()
    sessions.act({ action: 'start', blockId }); advance(60000)
    const id = sessions.active()!.id
    sessions.act({ action: 'pause', id }); advance(600000); sessions.act({ action: 'pause', id })
    expect(sessions.active()!.elapsedSeconds).toBe(60)
    sessions.act({ action: 'resume', id }); advance(120000); sessions.act({ action: 'finish', id })
    expect(sessions.active()!.elapsedSeconds).toBe(180)
    sessions.act({ action: 'outcome', id, outcome: 'completed', elapsedSeconds: 150, work: 'Solved and reviewed', interruption: '' })
    const revision = store.revision
    sessions.act({ action: 'outcome', id, outcome: 'completed', elapsedSeconds: 150, work: 'Duplicate', interruption: '' })
    expect(store.revision).toBe(revision); expect(store.snapshot().tasks[0].status).toBe('done'); store.close()
  })
  it('requires time reconciliation after sleep or crash before resuming', () => {
    const { store, sessions, blockId, advance } = setup()
    sessions.act({ action: 'start', blockId }); advance(120000); sessions.suspend()
    const id = sessions.active()!.id; advance(3600000)
    expect(() => sessions.act({ action: 'resume', id })).toThrow('Confirm')
    sessions.act({ action: 'reconcile', id, elapsedSeconds: 120 }); sessions.act({ action: 'resume', id })
    sessions.recover(); expect(sessions.active()!.needsReconciliation).toBe(true)
    expect(sessions.active()!.elapsedSeconds).toBe(120); store.close()
  })
})
describe('local notifications', () => {
  it('respects quiet hours across midnight and deduplicates delivered notifications', () => {
    const { store } = setup(), send = vi.fn(() => true), notices = new LocalNotifications(store, send)
    expect(isQuiet(store.snapshot().profile, Date.parse('2026-10-04T19:00:00Z'))).toBe(true)
    expect(notices.deliver('one', 'Title', 'Body', Date.parse('2026-10-04T14:30:00Z'))).toBe(true)
    expect(notices.deliver('one', 'Title', 'Body', Date.parse('2026-10-04T14:30:00Z'))).toBe(false)
    expect(notices.deliver('two', 'Title', 'Body', Date.parse('2026-10-04T19:00:00Z'))).toBe(false)
    expect(send).toHaveBeenCalledTimes(1); store.close()
  })
})
