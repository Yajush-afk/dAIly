import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { Sessions } from '../src/main/sessions'
import { DayApplication } from '../src/main/application'
import { decisionConstraints } from '../src/main/policy'
import { stateChanges } from '../src/main/state-updates'
import { defaultProfile } from '../src/shared/state'

const now = Date.parse('2026-10-04T14:30:00Z')
function setup() {
  const store = new Store(':memory:'),
    goalId = randomUUID(),
    taskId = randomUUID()
  store.saveConfig({
    profile: { ...defaultProfile, timezone: 'Asia/Kolkata', onboardingComplete: true },
    goals: [{ id: goalId, title: 'DSA', priority: 2, deadline: null }],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Review a graph example',
        status: 'todo',
        deadline: null,
        estimateMinutes: 20,
      },
    ],
    timetable: [],
  })
  const decision = {
    kind: 'propose_plan',
    summary: 'A useful next step',
    choices: [{ taskId, minutes: 20, reason: 'One concrete step fits.' }],
    deferred: [],
  }
  const planner = new Planner(
    store,
    { chat: async () => ({ content: JSON.stringify(decision), durationMs: 1, tokens: 1 }) },
    () => now,
  )
  return { store, taskId, planner, sessions: new Sessions(store, () => now) }
}
describe('durable application architecture', () => {
  it('migrates an existing version-two database without rewriting personal records', () => {
    const root = mkdtempSync(join(tmpdir(), 'daily-migration-')),
      path = join(root, 'daily.db'),
      db = new Database(path)
    db.exec(
      'CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE notifications(key TEXT PRIMARY KEY,sent_at TEXT NOT NULL); PRAGMA user_version=2',
    )
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('revision', '21')
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('profile', JSON.stringify(defaultProfile))
    const id = randomUUID(),
      raw = JSON.stringify({
        id,
        at: new Date(now).toISOString(),
        role: 'user',
        text: 'My existing history',
      })
    db.prepare('INSERT INTO records VALUES (?,?,?)').run('messages', id, raw)
    db.close()
    const store = new Store(path)
    try {
      expect(store.db.pragma('user_version', { simple: true })).toBe(3)
      expect(store.revision).toBe(21)
      expect(store.planningRevision).toBe(0)
      expect(store.get('messages', id)?.text).toBe('My existing history')
      expect(
        (store.db.prepare('SELECT value FROM records WHERE id=?').get(id) as { value: string })
          .value,
      ).toBe(raw)
    } finally {
      store.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('keeps timer reads independent of the total history and uses an active-session index', () => {
    const { store, sessions } = setup(),
      full = vi.spyOn(store, 'snapshot'),
      lists = vi.spyOn(store, 'list')
    store.profile()
    lists.mockClear()
    for (let i = 0; i < 20; i++) {
      sessions.tick()
      store.runtimeState(now)
    }
    expect(full).not.toHaveBeenCalled()
    expect(lists).not.toHaveBeenCalled()
    const plan = store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value FROM records WHERE kind='sessions' AND json_extract(value,'$.state') != 'finished' LIMIT 1",
      )
      .all()
    expect(JSON.stringify(plan)).toContain('sessions_active')
    store.close()
  })
  it('paginates history without duplicates while new records arrive', () => {
    const { store } = setup()
    for (let i = 0; i < 7; i++)
      store.put('plans', {
        id: randomUUID(),
        createdAt: new Date(now - i * 86400000).toISOString(),
        contextRevision: 0,
        summary: String(i),
        status: 'superseded',
        blocks: [],
        deferred: [],
      })
    const first = store.history({ kind: 'plans', limit: 3 })
    store.put('plans', {
      id: randomUUID(),
      createdAt: new Date(now).toISOString(),
      contextRevision: 0,
      summary: 'New',
      status: 'proposed',
      blocks: [],
      deferred: [],
    })
    const second = store.history({ kind: 'plans', before: first.next!, limit: 3 })
    const third = store.history({ kind: 'plans', before: second.next!, limit: 3 })
    const ids = [...first.plans, ...second.plans, ...third.plans].map((p) => p.id)
    expect(new Set(ids).size).toBe(7)
    expect(third.next).toBeNull()
    expect(store.view().plans).toHaveLength(1)
    store.close()
  })
  it('does not invalidate proposals for appearance settings or unrelated conversation', async () => {
    const { store, planner } = setup(),
      result = await planner.request('Plan')
    store.put('messages', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      role: 'user',
      text: 'Thanks',
    })
    const config = store.config()
    store.saveConfig({ ...config, profile: { ...config.profile, theme: 'dark' } })
    expect(() => planner.accept(result.planId!)).not.toThrow()
    store.close()
  })
  it('rejects proposals when a deadline changes and rejects legacy proposals safely', async () => {
    const { store, planner } = setup(),
      result = await planner.request('Plan'),
      config = store.config()
    store.saveConfig({
      ...config,
      tasks: config.tasks.map((t) => ({ ...t, deadline: '2026-10-05' })),
    })
    expect(() => planner.accept(result.planId!)).toThrow('changed')
    const legacy = {
      ...store.get('plans', result.planId!)!,
      id: randomUUID(),
      inputRevision: undefined,
    }
    store.put('plans', legacy)
    expect(() => planner.accept(legacy.id)).toThrow('changed')
    store.close()
  })
  it('sends only changed collections to the renderer', () => {
    const { store } = setup(),
      before = store.view(),
      after = {
        ...before,
        revision: before.revision + 1,
        messages: [
          {
            id: randomUUID(),
            at: new Date(now).toISOString(),
            role: 'user' as const,
            text: 'Hello',
          },
        ],
      }
    expect(Object.keys(stateChanges(before, after)).sort()).toEqual(['messages', 'revision'])
    store.close()
  })
  it('preserves outcomes when the model is offline and does not replan duplicate reports', async () => {
    const { store, planner, sessions } = setup(),
      result = await planner.request('Plan')
    planner.accept(result.planId!)
    const blockId = store.get('plans', result.planId!)!.blocks[0].id
    sessions.act({ action: 'start', blockId })
    sessions.act({ action: 'finish', id: sessions.active()!.id })
    const id = sessions.active()!.id
    let calls = 0
    const offline = new Planner(
      store,
      {
        chat: async () => {
          calls++
          throw new Error('Ollama unavailable')
        },
      },
      () => now,
    )
    const application = new DayApplication(store, offline, sessions, () => now)
    const command = {
      action: 'outcome' as const,
      id,
      outcome: 'partial' as const,
      elapsedSeconds: 300,
      work: 'Read one example',
      interruption: '',
    }
    const response = await application.recordOutcome(command)
    expect(response.planningError).toContain('unavailable')
    expect(store.get('sessions', id)?.work).toBe('Read one example')
    await application.recordOutcome(command)
    expect(calls).toBe(1)
    store.close()
  })
  it('stores bounded diagnostics without raw conversation or model payloads', async () => {
    const { store, planner } = setup()
    await planner.request('private-note-marker')
    const reports = JSON.stringify(store.diagnostics())
    expect(reports).toContain('durationMs')
    expect(reports).not.toContain('private-note-marker')
    expect(reports).not.toContain('A useful next step')
    store.close()
  })
  it('saves reviewed changes once and records their approval atomically', async () => {
    const { store, sessions } = setup(),
      goalId = store.config().goals[0].id
    const planner = new Planner(
      store,
      {
        chat: async () => ({
          content: JSON.stringify({
            kind: 'propose_changes',
            explanation: 'Try a smaller step',
            tasks: [{ goalId, title: 'Read the first example', estimateMinutes: 10 }],
            preferences: {},
          }),
          durationMs: 1,
          tokens: 1,
        }),
      },
      () => now,
    )
    const result = await planner.request('Suggest a smaller step'),
      app = new DayApplication(store, planner, sessions, () => now)
    const review = {
      decisionId: result.decisionId!,
      tasks: [{ goalId, title: 'Read my chosen example', estimateMinutes: 15 }],
    }
    app.approveChanges(review)
    app.approveChanges(review)
    expect(store.config().tasks).toHaveLength(2)
    expect(
      store.snapshot().messages.filter((m) => m.details?.type === 'changes-accept'),
    ).toHaveLength(1)
    store.close()
  })
  it('records a check-in across midnight even when replanning fails', async () => {
    const { store, sessions } = setup(),
      config = store.config()
    store.saveConfig({ ...config, profile: { ...config.profile, bedtime: '02:00' } })
    const planner = new Planner(
      store,
      {
        chat: async () => {
          throw new Error('Offline')
        },
      },
      () => now,
    )
    const response = await new DayApplication(store, planner, sessions, () => now).checkInAndPlan({
      text: 'Home late',
      until: '01:00',
      energy: 'low',
      busyStart: '23:00',
      busyEnd: '00:00',
    })
    expect(response.planningError).toContain('Offline')
    const checkIn = store.snapshot().checkIns[0]
    expect(checkIn.availableUntil).toBe('2026-10-04T19:30:00.000Z')
    expect(checkIn.busy[0].end).toBe('2026-10-04T18:30:00.000Z')
    store.close()
  })
  it('keeps failed-response diagnostics free of raw output snippets', async () => {
    const { store } = setup()
    const planner = new Planner(
      store,
      { chat: async () => ({ content: 'private-model-output-marker', durationMs: 1, tokens: 1 }) },
      () => now,
    )
    await expect(planner.request('private-user-marker')).rejects.toThrow('usable decision')
    const report = JSON.stringify(store.diagnostics())
    expect(report).toContain('invalid_json')
    expect(report).not.toContain('private-model-output-marker')
    expect(report).not.toContain('private-user-marker')
    store.close()
  })
  it('does not keep asking about deferrals after a task is completed', () => {
    const { store, taskId } = setup(),
      state = store.snapshot()
    state.plans = [1, 2, 3].map((day) => ({
      id: randomUUID(),
      createdAt: new Date(now - day * 86400000).toISOString(),
      contextRevision: 0,
      summary: 'Deferred',
      status: 'superseded',
      blocks: [],
      deferred: [{ taskId, reason: 'Other work' }],
    }))
    expect(decisionConstraints(state, now).repeatedObstacles).toHaveLength(1)
    state.tasks[0].status = 'done'
    expect(decisionConstraints(state, now).repeatedObstacles).toEqual([])
    store.close()
  })
  it('indexes newest-message and cursor reads instead of sorting all history', () => {
    const { store } = setup()
    const plan = store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value FROM records WHERE kind='messages' ORDER BY rowid DESC LIMIT 20",
      )
      .all()
    expect(JSON.stringify(plan)).toContain('records_order')
    expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE')
    store.close()
  })
})
