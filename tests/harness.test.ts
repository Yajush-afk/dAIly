import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { Planner, planningContext, modelFormat } from '../src/main/planner'
import { defaultProfile } from '../src/shared/state'

function setup(): { store: Store; now: number; taskId: string } {
  const store = new Store(':memory:'),
    goalId = randomUUID(),
    taskId = randomUUID(),
    now = Date.parse('2026-10-04T14:30:00Z')
  store.saveConfig({
    profile: { ...defaultProfile, timezone: 'Asia/Kolkata' },
    goals: [{ id: goalId, title: 'Exams', priority: 1, deadline: '2026-10-05' }],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Revise a topic',
        status: 'todo',
        estimateMinutes: 30,
        deadline: '2026-10-05',
      },
    ],
    timetable: [],
  })
  return { store, now, taskId }
}
const output = (taskId: string, minutes = 30) => ({
  kind: 'propose_plan',
  summary: 'A practical next step',
  choices: [{ taskId, minutes, reason: 'Prepare for the exam tomorrow.' }],
  deferred: [],
})
describe('planner harness edge cases', () => {
  it('bounds long context while retaining deadlines and recent factual outcomes', () => {
    const { store, now, taskId } = setup(),
      s = store.snapshot()
    s.tasks = Array.from({ length: 100 }, (_, i) => ({
      ...s.tasks[0],
      id: i === 0 ? taskId : randomUUID(),
      title: 'x'.repeat(500),
      deadline: i === 0 ? '2026-10-05' : '2026-11-01',
    }))
    s.messages = Array.from({ length: 20 }, () => ({
      id: randomUUID(),
      at: new Date(now).toISOString(),
      role: 'user',
      text: 'y'.repeat(12000),
    }))
    const context = JSON.stringify(planningContext(s, now))
    expect(context.length).toBeLessThanOrEqual(10000)
    expect(context).toContain(taskId)
    expect(context).toContain('omittedTaskCount')
    store.close()
  })
  it('uses an earlier goal deadline even when a task has a later date', () => {
    const { store, now } = setup(),
      s = store.snapshot(),
      earlyGoal = randomUUID(),
      firstTask = randomUUID()
    s.goals.push({ id: earlyGoal, title: 'Application', priority: 5, deadline: '2026-10-04' })
    s.tasks.push({
      id: firstTask,
      goalId: earlyGoal,
      title: 'Submit application',
      status: 'todo',
      estimateMinutes: 15,
      deadline: '2026-10-10',
    })
    const context = planningContext(s, now) as { tasks: { id: string }[] }
    expect(context.tasks[0].id).toBe(firstTask)
    store.close()
  })
  it('handles exhausted time without calling a model or changing preferences', async () => {
    const { store, now } = setup()
    store.put('checkIns', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(now).toISOString(),
      energy: 'low',
      note: '',
      busy: [],
    })
    const planner = new Planner(
      store,
      {
        chat: async () => {
          throw new Error('Must not call model')
        },
      },
      () => now,
    )
    expect((await planner.request('Plan')).origin).toBe('availability')
    expect(store.snapshot().profile.focusMinutes).toBe(45)
    store.close()
  })
  it('binds model task identifiers to unfinished application records', () => {
    const { store, taskId } = setup(),
      s = store.snapshot(),
      doneId = randomUUID()
    s.tasks.push({ ...s.tasks[0], id: doneId, status: 'done' })
    const format = JSON.stringify(modelFormat(s))
    expect(format).toContain(taskId)
    expect(format).not.toContain(doneId)
    expect(format).toContain('enum')
    store.close()
  })
  it('keeps mentor reflection available after the planning cutoff', async () => {
    const { store, now } = setup()
    store.put('checkIns', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(now).toISOString(),
      energy: 'low',
      note: '',
      busy: [],
    })
    let called = false
    const planner = new Planner(
      store,
      {
        chat: async () => {
          called = true
          return {
            content: JSON.stringify({
              kind: 'respond',
              explanation:
                'The interruption you recorded was a difficult starting point. We can discuss a smaller step tomorrow.',
            }),
            durationMs: 1,
            tokens: 1,
          }
        },
      },
      () => now,
    )
    expect((await planner.request('Reflect on today', 'conversation')).origin).toBe('gemma')
    expect(called).toBe(true)
    store.close()
  })
  it('uses the actual decision time instead of scheduling into inference time', async () => {
    const { store, now, taskId } = setup()
    let current = now
    const planner = new Planner(
      store,
      {
        chat: async () => {
          current += 90000
          return { content: JSON.stringify(output(taskId)), durationMs: 90000, tokens: 1 }
        },
      },
      () => current,
    )
    const r = await planner.request('Plan')
    expect(Date.parse(store.snapshot().plans.find((p) => p.id === r.planId)!.blocks[0].start)).toBe(
      now + 90000,
    )
    store.close()
  })
  it('repairs low-energy overload once with explicit validation feedback', async () => {
    const { store, now, taskId } = setup()
    let calls = 0
    store.put('checkIns', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(now + 20 * 60000).toISOString(),
      energy: 'low',
      note: '',
      busy: [],
    })
    const planner = new Planner(
      store,
      {
        chat: async (messages) => {
          calls++
          if (calls === 2) expect(messages.at(-1)?.content).toContain('at most 20 minutes')
          return {
            content: JSON.stringify(output(taskId, calls === 1 ? 30 : 15)),
            durationMs: 1,
            tokens: 1,
          }
        },
      },
      () => now,
    )
    const r = await planner.request('Plan')
    expect(calls).toBe(2)
    expect(store.snapshot().plans.find((p) => p.id === r.planId)!.blocks[0].end).toBe(
      new Date(now + 15 * 60000).toISOString(),
    )
    store.close()
  })
  it('rejects model attempts to claim completed work as part of a plan', async () => {
    const { store, now, taskId } = setup()
    const planner = new Planner(
      store,
      {
        chat: async () => ({
          content: JSON.stringify({ ...output(taskId), completed: [taskId], elapsedSeconds: 3600 }),
          durationMs: 1,
          tokens: 1,
        }),
      },
      () => now,
    )
    await expect(planner.request('Plan')).rejects.toThrow('usable decision')
    expect(store.snapshot().tasks[0].status).toBe('todo')
    expect(store.snapshot().sessions).toEqual([])
    store.close()
  })
  it('serializes requests and recovers after a cancelled model request', async () => {
    const { store, now } = setup()
    let reject: (reason: Error) => void = () => {}
    const planner = new Planner(
      store,
      {
        chat: () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      },
      () => now,
    )
    const first = planner.request('Plan')
    await expect(planner.request('Duplicate')).rejects.toThrow('already running')
    reject(new Error('Request cancelled'))
    await expect(first).rejects.toThrow('cancelled')
    expect(store.snapshot().plans).toEqual([])
    const again = planner.request('Retry')
    reject(new Error('Request cancelled'))
    await expect(again).rejects.toThrow('cancelled')
    store.close()
  })
  it('asks or stops when there is no usable time and saves no invented blocks', async () => {
    const { store, now } = setup()
    store.put('checkIns', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(now).toISOString(),
      energy: 'low',
      note: '',
      busy: [],
    })
    const planner = new Planner(
      store,
      {
        chat: async () => ({
          content: JSON.stringify({
            kind: 'respond',
            explanation: 'Stop here for today. There is no useful time left.',
          }),
          durationMs: 1,
          tokens: 1,
        }),
      },
      () => now,
    )
    expect((await planner.request('Plan')).decision.kind).toBe('respond')
    expect(store.snapshot().plans).toEqual([])
    store.close()
  })
})
