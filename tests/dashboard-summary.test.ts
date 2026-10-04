import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { Store } from '../src/main/store'
import { defaultProfile, type FocusSession } from '../src/shared/state'
import { HistoryQuerySchema } from '../src/shared/history'
function fixture(zone = 'Asia/Kolkata') {
  const store = new Store(':memory:'),
    goalId = randomUUID(),
    taskId = randomUUID()
  store.saveConfig({
    profile: { ...defaultProfile, timezone: zone },
    goals: [{ id: goalId, title: 'DSA', priority: 5, deadline: null }],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Practice',
        estimateMinutes: null,
        deadline: null,
        status: 'todo',
      },
    ],
    timetable: [],
  })
  const add = (finishedAt: string, patch: Partial<FocusSession> = {}) => {
    const session: FocusSession = {
      id: randomUUID(),
      taskId,
      blockId: null,
      startedAt: '2026-10-01T10:00:00.000Z',
      segmentStartedAt: null,
      targetMinutes: 45,
      elapsedSeconds: 600,
      state: 'finished',
      outcome: 'partial',
      work: 'Practised a problem.',
      interruption: '',
      finishedAt,
      needsReconciliation: false,
      ...patch,
    }
    store.put('sessions', session)
    return session
  }
  return { store, goalId, taskId, add }
}
describe('dashboard and ranged history summaries', () => {
  it('uses the profile timezone and outcome date for yesterday, including all reported outcomes', () => {
    const { store, add } = fixture()
    add('2026-10-02T18:30:00.000Z', { outcome: 'interrupted', elapsedSeconds: 300 })
    add('2026-10-03T18:29:59.000Z', { outcome: 'abandoned', elapsedSeconds: 120 })
    add('2026-10-03T18:30:00.000Z')
    const summary = store.dashboardSummary(Date.parse('2026-10-04T10:00:00.000Z'))
    expect(summary.yesterday).toMatchObject({ date: '2026-10-03', sessions: 2, seconds: 420 })
    expect(summary.yesterday.recentWork).toHaveLength(2)
    store.close()
  })
  it('keeps totals independent of pagination and includes deleted goal time', () => {
    const { store, add } = fixture('UTC')
    for (let i = 0; i < 5; i++) add('2026-10-03T10:00:00.000Z')
    add('2026-10-05T10:00:00.000Z')
    const range = {
      kind: 'sessions' as const,
      limit: 2,
      from: '2026-10-03T00:00:00.000Z',
      until: '2026-10-04T00:00:00.000Z',
    }
    const first = store.history(range),
      second = store.history({ ...range, before: first.next! })
    expect(first.sessions).toHaveLength(2)
    expect(first.totals).toMatchObject({
      sessions: 5,
      seconds: 3000,
      byDay: [{ date: '2026-10-03', sessions: 5, seconds: 3000 }],
    })
    expect(second.totals).toEqual(first.totals)
    expect(second.sessions[0].id).not.toBe(first.sessions[0].id)
    store.saveConfig({ ...store.config(), goals: [], tasks: [] })
    expect(store.history(range).totals.byGoal).toEqual([
      { goalId: null, sessions: 5, seconds: 3000 },
    ])
    expect(store.history({ kind: 'sessions', limit: 2 }).totals.seconds).toBe(3600)
    store.close()
  })
  it('counts pending outcomes separately without calling them completed work', () => {
    const { store, add } = fixture()
    add('2026-10-03T10:00:00.000Z', { state: 'awaiting-outcome', outcome: null, finishedAt: null })
    expect(store.dashboardSummary(Date.parse('2026-10-04T10:00:00.000Z'))).toMatchObject({
      pendingOutcomes: 1,
      yesterday: { sessions: 0, seconds: 0 },
    })
    store.close()
  })
  it('handles a 25-hour daylight saving day without fixed 24-hour arithmetic', () => {
    const { store, add } = fixture('America/New_York')
    add('2026-11-01T04:00:00.000Z')
    add('2026-11-02T04:59:59.000Z')
    add('2026-11-02T05:00:00.000Z')
    expect(store.dashboardSummary(Date.parse('2026-11-02T12:00:00.000Z')).yesterday).toMatchObject({
      date: '2026-11-01',
      sessions: 2,
      seconds: 1200,
    })
    store.close()
  })
  it('rejects reversed ranges', () => {
    expect(
      HistoryQuerySchema.safeParse({
        kind: 'sessions',
        from: '2026-10-04T00:00:00.000Z',
        until: '2026-10-03T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})
