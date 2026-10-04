import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { availableIntervals, schedule } from '../src/main/scheduler'
import { orderPlanChoices, validateDecision } from '../src/main/policy'
import { defaultProfile, type Snapshot } from '../src/shared/state'
import type { Decision } from '../src/shared/planner'

export function scenario(): Snapshot {
  const goalId = randomUUID()
  return {
    revision: 0,
    profile: { ...defaultProfile, timezone: 'Asia/Kolkata', bedtime: '02:00' },
    goals: [{ id: goalId, title: 'Exams', priority: 1, deadline: '2026-10-05' }],
    tasks: [
      {
        id: randomUUID(),
        goalId,
        title: 'Revise graphs',
        estimateMinutes: 45,
        deadline: '2026-10-05',
        status: 'todo',
      },
    ],
    timetable: [],
    checkIns: [],
    plans: [],
    sessions: [],
    messages: [],
  }
}
const now = Date.parse('2026-10-04T18:00:00+05:30')
const proposal = (s: Snapshot): Extract<Decision, { kind: 'propose_plan' }> => ({
  kind: 'propose_plan',
  summary: 'Prepare for tomorrow',
  choices: [{ taskId: s.tasks[0].id, minutes: 30, reason: 'Your exam is tomorrow.' }],
  deferred: [],
})
describe('deterministic planning', () => {
  it('uses the next morning cutoff for a bedtime after midnight', () => {
    const s = scenario()
    expect(new Date(availableIntervals(s, now)[0].end).toISOString()).toBe(
      '2026-10-04T20:30:00.000Z',
    )
    expect(availableIntervals(s, Date.parse('2026-10-05T03:00:00+05:30'))).toEqual([])
  })
  it('subtracts commitments, commute and dated cancellations', () => {
    const s = scenario()
    s.timetable = [
      {
        id: randomUUID(),
        weekday: 0,
        date: null,
        title: 'Class',
        start: '18:00',
        end: '20:00',
        cancelled: false,
      },
    ]
    expect(new Date(availableIntervals(s, now)[0].start).toISOString()).toBe(
      '2026-10-04T15:00:00.000Z',
    )
    s.timetable.push({ ...s.timetable[0], id: randomUUID(), date: '2026-10-04', cancelled: true })
    expect(availableIntervals(s, now)[0].start).toBe(now)
  })
  it('defers a block when there is insufficient time and rejects invented tasks', () => {
    const s = scenario()
    s.checkIns.push({
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(now + 600000).toISOString(),
      energy: 'low',
      note: '',
      busy: [],
    })
    const p = schedule(s, proposal(s), now)
    expect(p.blocks).toEqual([])
    expect(p.deferred).toHaveLength(1)
    expect(() =>
      schedule(
        s,
        { ...proposal(s), choices: [{ ...proposal(s).choices[0], taskId: randomUUID() }] },
        now,
      ),
    ).toThrow('unknown')
  })
  it('rejects renamed copies and no-op preference suggestions', () => {
    const s = scenario()
    expect(() =>
      validateDecision(
        s,
        {
          kind: 'propose_changes',
          explanation: 'Try a smaller step.',
          tasks: [{ goalId: s.goals[0].id, title: 'revise graphs!', estimateMinutes: 15 }],
          preferences: {},
        },
        now,
      ),
    ).toThrow('renamed copies')
    expect(() =>
      validateDecision(
        s,
        {
          kind: 'propose_changes',
          explanation: 'Adjust the focus preference.',
          tasks: [],
          preferences: { focusMinutes: s.profile.focusMinutes },
        },
        now,
      ),
    ).toThrow('current setting')
  })
  it('orders selected tasks by deadline before open-ended tasks', () => {
    const s = scenario(),
      openGoalId = randomUUID(),
      openTaskId = randomUUID()
    s.goals.push({ id: openGoalId, title: 'DSA', priority: 5, deadline: null })
    s.tasks.push({
      id: openTaskId,
      goalId: openGoalId,
      title: 'Solve a graph problem',
      estimateMinutes: 30,
      deadline: null,
      status: 'todo',
    })
    const decision = orderPlanChoices(s, {
      kind: 'propose_plan',
      summary: 'Do both tasks.',
      choices: [
        { taskId: openTaskId, minutes: 15, reason: 'Make progress on DSA.' },
        { taskId: s.tasks[0].id, minutes: 15, reason: 'Review for the exam.' },
      ],
      deferred: [],
    })
    expect(decision.kind).toBe('propose_plan')
    if (decision.kind === 'propose_plan') expect(decision.choices[0].taskId).toBe(s.tasks[0].id)
  })
  it('repairs invalid output once and discards results if state changed', async () => {
    const s = scenario(),
      store = new Store(':memory:')
    store.saveConfig({ profile: s.profile, goals: s.goals, tasks: s.tasks, timetable: s.timetable })
    let calls = 0
    const planner = new Planner(
      store,
      {
        chat: async () => ({
          content: ++calls === 1 ? '{}' : JSON.stringify(proposal(s)),
          durationMs: 1,
          tokens: 1,
        }),
      },
      () => now,
    )
    const result = await planner.request('Plan my evening')
    expect(calls).toBe(2)
    expect(result.planId).toBeDefined()
    planner.accept(result.planId!)
    const stale = new Planner(
      store,
      {
        chat: async () => {
          store.put('checkIns', {
            id: randomUUID(),
            at: new Date(now).toISOString(),
            availableUntil: null,
            energy: 'low',
            note: 'Changed',
            busy: [],
          })
          return { content: JSON.stringify(proposal(s)), durationMs: 1, tokens: 1 }
        },
      },
      () => now,
    )
    await expect(stale.request('Again')).rejects.toThrow('changed')
    expect(store.snapshot().plans.filter((p) => p.status === 'accepted')).toHaveLength(1)
    store.close()
  })
})
