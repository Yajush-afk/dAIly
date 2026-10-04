import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { Planner, decisionConstraints } from '../src/main/planner'
import { Sessions } from '../src/main/sessions'
import { schedule, availableIntervals, currentCheckIn } from '../src/main/scheduler'
import { arrivalDue } from '../src/main/notifications'
import { defaultProfile, type Snapshot } from '../src/shared/state'

function fixture(): { store: Store; now: number } {
  const store = new Store(':memory:'), goalId = randomUUID()
  const now = Date.parse('2026-10-04T14:30:00Z')
  store.saveConfig({ profile: { ...defaultProfile, timezone: 'Asia/Kolkata', onboardingComplete: true }, goals: [{ id: goalId, title: 'Exams', priority: 1, deadline: '2026-10-05' }], tasks: ['Revise graphs', 'Review algorithms'].map(title => ({ id: randomUUID(), goalId, title, status: 'todo', estimateMinutes: 30, deadline: '2026-10-05' })), timetable: [] })
  return { store, now }
}
const proposal = (s: Snapshot) => ({ kind: 'propose_plan' as const, summary: 'Two achievable blocks', choices: s.tasks.map(t => ({ taskId: t.id, minutes: 30, reason: 'Your exam is tomorrow.' })), deferred: [] })
describe('complete workflow safeguards', () => {
  it('treats yesterday or future check-ins as unknown instead of today\'s energy', () => {
    const { store, now } = fixture(), s = store.snapshot()
    s.checkIns.push({ id: randomUUID(), at: new Date(now - 24 * 3600000).toISOString(), availableUntil: null, energy: 'low', note: '', busy: [] })
    s.checkIns.push({ ...s.checkIns[0], id: randomUUID(), at: new Date(now + 3600000).toISOString() })
    expect(currentCheckIn(s, now)).toBeUndefined(); expect(decisionConstraints(s, now).maxBlockMinutes).toBe(45); store.close()
  })
  it('reduces low-energy block limits and identifies repeated interruptions', () => {
    const { store, now } = fixture(), s = store.snapshot()
    s.checkIns.push({ id: randomUUID(), at: new Date(now).toISOString(), availableUntil: new Date(now + 120 * 60000).toISOString(), energy: 'low', note: '', busy: [] })
    for (let day = 1; day <= 3; day++) s.sessions.push({ id: randomUUID(), taskId: s.tasks[0].id, blockId: null, startedAt: new Date(now - day * 86400000).toISOString(), targetMinutes: 30, elapsedSeconds: 300, state: 'finished', outcome: 'interrupted', work: '', interruption: 'Could not start', segmentStartedAt: null, finishedAt: new Date(now).toISOString(), needsReconciliation: false })
    expect(decisionConstraints(s, now).maxBlockMinutes).toBe(20)
    expect(decisionConstraints(s, now).repeatedObstacles[0].taskId).toBe(s.tasks[0].id); store.close()
  })
  it('places breaks without crossing unavailable intervals', () => {
    const { store, now } = fixture(), s = store.snapshot()
    s.checkIns.push({ id: randomUUID(), at: new Date(now).toISOString(), availableUntil: new Date(now + 100 * 60000).toISOString(), energy: 'okay', note: '', busy: [{ start: new Date(now + 35 * 60000).toISOString(), end: new Date(now + 50 * 60000).toISOString(), title: 'Dinner' }] })
    const p = schedule(s, proposal(s), now)
    expect(p.blocks.filter(b => b.kind === 'focus')).toHaveLength(2)
    expect(p.blocks.every(b => availableIntervals(s, now).some(i => Date.parse(b.start) >= i.start && Date.parse(b.end) <= i.end))).toBe(true)
    expect(Date.parse(p.blocks.at(-1)!.start)).toBe(now + 50 * 60000); store.close()
  })
  it('counts repeated deferrals by distinct day instead of revisions', () => {
    const { store, now } = fixture(), s = store.snapshot()
    const p = { ...schedule(s, proposal(s), now), blocks: [], deferred: [{ taskId: s.tasks[0].id, reason: 'Other work came first' }] }
    s.plans = [0, 0, 0].map(day => ({ ...p, id: randomUUID(), createdAt: new Date(now - day * 86400000).toISOString() }))
    expect(decisionConstraints(s, now).repeatedObstacles).toEqual([])
    s.plans = [1, 2, 3].map(day => ({ ...p, id: randomUUID(), createdAt: new Date(now - day * 86400000).toISOString() }))
    expect(decisionConstraints(s, now).repeatedObstacles[0].deferredDays).toBe(3); store.close()
  })
  it('preserves the accepted plan when both model attempts are invalid', async () => {
    const { store, now } = fixture()
    const prior = { ...schedule(store.snapshot(), proposal(store.snapshot()), now), status: 'accepted' as const }
    store.put('plans', prior)
    const planner = new Planner(store, { chat: async () => ({ content: '{', durationMs: 1, tokens: 1 }) }, () => now)
    await expect(planner.request('Plan')).rejects.toThrow('unchanged')
    expect(store.snapshot().plans).toEqual([prior]); store.close()
  })
  it('rejects a proposal accepted after context changed', async () => {
    const { store, now } = fixture()
    const planner = new Planner(store, { chat: async () => ({ content: JSON.stringify(proposal(store.snapshot())), durationMs: 1, tokens: 1 }) }, () => now)
    const result = await planner.request('Plan')
    store.saveConfig({ profile: { ...store.snapshot().profile, focusMinutes: 20 }, goals: store.snapshot().goals, tasks: store.snapshot().tasks, timetable: [] })
    expect(() => planner.accept(result.planId!)).toThrow('changed'); store.close()
  })
  it('rejects fabricated deferrals and oversized focus blocks', () => {
    const { store, now } = fixture(), s = store.snapshot()
    expect(() => schedule(s, { ...proposal(s), deferred: [{ taskId: randomUUID(), reason: 'Unknown' }] }, now)).toThrow('Deferrals')
    expect(() => schedule(s, { ...proposal(s), choices: [{ ...proposal(s).choices[0], minutes: 120 }] }, now)).toThrow('focus duration'); store.close()
  })
  it('preserves an interrupted session and uncounted crash time after reopening', () => {
    const root = mkdtempSync(join(tmpdir(), 'daily-recovery-')), { store: original, now } = fixture()
    const s = original.snapshot(); original.close()
    const path = join(root, 'state.db'), store = new Store(path)
    store.saveConfig({ profile: s.profile, goals: s.goals, tasks: s.tasks, timetable: [] })
    const plan = { ...schedule(store.snapshot(), proposal(store.snapshot()), now), status: 'accepted' as const }; store.put('plans', plan)
    new Sessions(store, () => now).act({ action: 'start', blockId: plan.blocks[0].id }); store.close()
    const reopened = new Store(path), sessions = new Sessions(reopened, () => now + 3600000); sessions.recover()
    expect(sessions.active()?.elapsedSeconds).toBe(0); expect(sessions.active()?.needsReconciliation).toBe(true)
    const id = sessions.active()!.id
    sessions.act({ action: 'outcome', id, outcome: 'interrupted', elapsedSeconds: 420, work: 'Read one section', interruption: 'Laptop restarted' })
    expect(reopened.snapshot().tasks[0].status).toBe('todo'); expect(reopened.snapshot().plans[0]).toEqual(plan)
    reopened.close(); rmSync(root, { recursive: true, force: true })
  })
  it('does not send an arrival check-in if the day was already reported', () => {
    const { store } = fixture(), s = store.snapshot(), now = Date.parse('2026-10-04T12:00:00Z')
    s.profile.notifications = true; s.profile.arrivalCheckIn = true
    s.timetable = [{ id: randomUUID(), weekday: 0, date: null, title: 'Class', start: '09:00', end: '17:00', cancelled: false }]
    expect(arrivalDue(s, now)).toBe('arrival:2026-10-04')
    s.checkIns.push({ id: randomUUID(), at: new Date(now).toISOString(), availableUntil: null, energy: 'unknown', note: '', busy: [] })
    expect(arrivalDue(s, now)).toBeUndefined(); store.close()
  })
  it('rolls back invalid configuration and refuses a future database version', () => {
    const { store } = fixture(), before = store.snapshot()
    expect(() => store.saveConfig({ profile: before.profile, goals: [], tasks: before.tasks, timetable: [] })).toThrow()
    expect(store.snapshot()).toEqual(before)
    const root = mkdtempSync(join(tmpdir(), 'daily-version-')), path = join(root, 'state.db'), future = new Store(path)
    future.db.pragma('user_version = 99'); future.close()
    expect(() => new Store(path)).toThrow('newer'); store.close(); rmSync(root, { recursive: true, force: true })
  })
})
