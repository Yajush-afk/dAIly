import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { Sessions } from '../src/main/sessions'
import { DayApplication } from '../src/main/application'
import { defaultProfile } from '../src/shared/state'
import type { OllamaClient } from '../src/main/ollama'

const update =
  'I have time until 2.30. Tomorrow I have an assignment due - it will take an hour to finish.'
const draft = {
  title: 'Finish assignment',
  estimateMinutes: 60,
  deadline: '2026-10-05',
  sourceQuote: 'Tomorrow I have an assignment due - it will take an hour to finish.',
}
function setup() {
  const store = new Store(':memory:')
  let now = Date.parse('2026-10-04T22:00:00Z')
  const goalId = randomUUID(),
    taskId = randomUUID()
  store.saveConfig({
    profile: {
      ...defaultProfile,
      timezone: 'UTC',
      onboardingComplete: true,
      bedtime: '02:30',
      wakeTime: '08:00',
      focusMinutes: 45,
    },
    goals: [{ id: goalId, title: 'DSA', priority: 5, deadline: '2027-03-01' }],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Dynamic Programming',
        estimateMinutes: 600,
        deadline: null,
        status: 'todo',
      },
    ],
    timetable: [],
  })
  const chat = vi.fn<Pick<OllamaClient, 'chat'>['chat']>().mockImplementation(async (messages) => {
    if (messages[0].content.startsWith('Identify new one-off'))
      return { content: JSON.stringify({ tasks: [draft] }), durationMs: 1, tokens: 1 }
    const context = JSON.parse(messages[1].content)
    const temporary = context.tasks.find((task: { goalId: string | null }) => task.goalId === null)
    return {
      content: JSON.stringify({
        kind: 'propose_plan',
        summary: 'Finish the assignment, take a break, then practise DP.',
        choices: [
          ...(temporary
            ? [{ taskId: temporary.id, minutes: 60, reason: 'Your assignment is due tomorrow.' }]
            : []),
          { taskId, minutes: 45, reason: 'Keep interview preparation moving.' },
        ],
        deferred: [],
      }),
      durationMs: 1,
      tokens: 1,
    }
  })
  const planner = new Planner(store, { chat }, () => now),
    sessions = new Sessions(store, () => now)
  const app = new DayApplication(store, planner, sessions, () => now)
  return {
    store,
    chat,
    app,
    planner,
    sessions,
    taskId,
    advance: (minutes: number) => {
      now += minutes * 60000
    },
    now: () => now,
  }
}
async function propose(app: DayApplication) {
  return app.checkInAndPlan({
    text: update,
    until: '02:30',
    energy: 'okay',
    busyStart: '',
    busyEnd: '',
  })
}
describe('temporary plan work', () => {
  it('reviews assignments before embedding them in a proposed plan with breaks and goal work', async () => {
    const { store, app, planner, sessions, advance } = setup()
    try {
      const before = store.config()
      const proposal = await propose(app)
      expect(proposal.result?.decision).toMatchObject({
        kind: 'propose_temporary_tasks',
        tasks: [draft],
      })
      expect(store.config()).toEqual(before)
      expect(store.openPlans()).toEqual([])
      const reviewed = await app.reviewTemporaryTasks({
        decisionId: proposal.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      expect(reviewed.planningError).toBeUndefined()
      const plan = store.get('plans', reviewed.result!.planId!)!
      expect(plan.status).toBe('proposed')
      expect(plan.temporaryTasks).toHaveLength(1)
      expect(store.list('tasks')).toEqual(before.tasks)
      expect(store.config()).toEqual(before)
      expect(plan.blocks.map((block) => block.title)).toEqual([
        'Finish assignment',
        'Take a break',
        'Finish assignment',
        'Take a break',
        'Dynamic Programming',
      ])
      const assignment = plan.temporaryTasks![0]
      expect(
        plan.blocks
          .filter((block) => block.taskId === assignment.id)
          .reduce(
            (total, block) => total + (Date.parse(block.end) - Date.parse(block.start)) / 60000,
            0,
          ),
      ).toBe(60)
      await expect(
        app.reviewTemporaryTasks({
          decisionId: proposal.result!.decisionId!,
          action: 'accept',
          tasks: [draft],
        }),
      ).resolves.toMatchObject({ state: expect.anything() })
      expect(store.activeTemporaryTasks(Date.parse(plan.createdAt))).toHaveLength(1)
      expect(() => sessions.act({ action: 'start', blockId: plan.blocks[0].id })).toThrow(
        'accepted plan',
      )
      planner.accept(plan.id)
      sessions.act({ action: 'start', blockId: plan.blocks[0].id })
      advance(30)
      sessions.tick()
      const active = sessions.active()!
      // Reported progress stays tied to the embedded task without creating a goal subtask.
      await app.recordOutcome({
        action: 'outcome',
        id: active.id,
        outcome: 'completed',
        elapsedSeconds: 1800,
        work: 'Finished my assignment',
        interruption: '',
      })
      expect(store.list('tasks')).toEqual(before.tasks)
      expect(store.snapshot().sessions[0].work).toBe('Finished my assignment')
      const history = store.history({ kind: 'sessions', limit: 20 })
      app.clearPlan()
      expect(store.history({ kind: 'sessions', limit: 20 })).toEqual(history)
      expect(history.totals.byGoal[0].goalId).toBeNull()
    } finally {
      store.close()
    }
  })
  it('retries a plan that ignores confirmed temporary work', async () => {
    const { store, app, chat, taskId } = setup()
    const original = chat.getMockImplementation()!
    let planningCalls = 0
    chat.mockImplementation(async (...args) => {
      if (!args[0][0].content.startsWith('Identify new one-off') && ++planningCalls === 1)
        return {
          content: JSON.stringify({
            kind: 'propose_plan',
            summary: 'Do DP.',
            choices: [{ taskId, minutes: 45, reason: 'DSA matters.' }],
            deferred: [],
          }),
          durationMs: 1,
          tokens: 1,
        }
      return original(...args)
    })
    try {
      const response = await propose(app)
      const planned = await app.reviewTemporaryTasks({
        decisionId: response.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      expect(planned.planningError).toBeUndefined()
      expect(planningCalls).toBe(2)
      expect(JSON.stringify(chat.mock.calls[1][1])).not.toContain('propose_changes')
      expect(store.get('plans', planned.result!.planId!)!.blocks[0].title).toBe(draft.title)
    } finally {
      store.close()
    }
  })
  it('requires a real quoted source rather than manufacturing work', async () => {
    const { store, app, chat } = setup()
    chat.mockResolvedValue({
      content: JSON.stringify({ tasks: [{ ...draft, sourceQuote: 'Invented obligation' }] }),
      durationMs: 1,
      tokens: 1,
    })
    try {
      const response = await propose(app)
      expect(response.planningError).toContain('existing plan is unchanged')
      expect(store.openPlans()).toEqual([])
      expect(store.list('tasks')).toHaveLength(1)
      expect(chat).toHaveBeenCalledTimes(2)
    } finally {
      store.close()
    }
  })
  it('blocks clearing until the active session outcome is saved', async () => {
    const { store, app, planner, sessions } = setup()
    try {
      const response = await propose(app)
      const planned = await app.reviewTemporaryTasks({
        decisionId: response.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      const plan = store.get('plans', planned.result!.planId!)!
      planner.accept(plan.id)
      sessions.act({ action: 'start', blockId: plan.blocks[0].id })
      expect(() => app.clearPlan()).toThrow('save its outcome')
      expect(store.openPlans()).toHaveLength(1)
      expect(sessions.active()?.state).toBe('running')
    } finally {
      store.close()
    }
  })
  it('skips a suggestion without creating temporary work', async () => {
    const { store, app } = setup()
    try {
      const response = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: response.result!.decisionId!,
        action: 'dismiss',
        tasks: [],
      })
      expect(store.openPlans().flatMap((plan) => plan.temporaryTasks || [])).toEqual([])
      expect(store.list('tasks')).toHaveLength(1)
    } finally {
      store.close()
    }
  })
  it('rejects stale review and leaves the saved plan untouched', async () => {
    const { store, app } = setup()
    try {
      const response = await propose(app)
      store.saveConfig({ ...store.config(), profile: { ...store.profile(), focusMinutes: 30 } })
      await expect(
        app.reviewTemporaryTasks({
          decisionId: response.result!.decisionId!,
          action: 'accept',
          tasks: [draft],
        }),
      ).rejects.toThrow('day changed')
      expect(store.openPlans()).toEqual([])
    } finally {
      store.close()
    }
  })
  it('clears open plans and temporary work without deleting goals or session history', async () => {
    const { store, app } = setup()
    try {
      const response = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: response.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      const before = store.config(),
        revision = store.planningRevision
      const cleared = app.clearPlan()
      expect(cleared.plans).toEqual([])
      expect(store.activeTemporaryTasks(Date.parse('2026-10-04T22:00:00Z'))).toEqual([])
      expect(store.config()).toEqual(before)
      expect(store.planningRevision).toBeGreaterThan(revision)
      expect(store.list('plans').length).toBeGreaterThan(0)
    } finally {
      store.close()
    }
  })
  it('does not carry temporary work into the next planning day', async () => {
    const { store, app, advance, now } = setup()
    try {
      const response = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: response.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      advance(300)
      expect(store.planningState(now()).tasks.every((task) => task.goalId !== null)).toBe(true)
      expect(store.list('plans').flatMap((plan) => plan.temporaryTasks || [])).not.toEqual([])
    } finally {
      store.close()
    }
  })
})
