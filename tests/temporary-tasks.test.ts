import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/store'
import { Planner, modelFormat, parsePlanningDecision } from '../src/main/planner'
import { Sessions } from '../src/main/sessions'
import { DayApplication } from '../src/main/application'
import { defaultProfile } from '../src/shared/state'
import type { OllamaClient } from '../src/main/ollama'
import { temporaryTaskExtractionSchemaForUpdate } from '../src/shared/temporary-tasks'
import { z } from 'zod'
import { requestedGoal, isGoalReference } from '../src/main/planning-preference'

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
  it('recognizes a goal revision without turning related new work into an existing goal', () => {
    const { store } = setup()
    try {
      const goals = store.config().goals
      expect(requestedGoal('Prioritize DSA instead of GSoC', goals)).toBe(goals[0].id)
      expect(requestedGoal('Do not focus on DSA', goals)).toBeUndefined()
      expect(isGoalReference('squeez DSA', goals)).toBe(true)
      expect(isGoalReference('Read a new DSA book', goals)).toBe(false)
    } finally {
      store.close()
    }
  })
  it('expires the saved goal preference at the planning cutoff', async () => {
    const { store, planner, app, now, advance } = setup()
    try {
      await propose(app)
      await planner.request('Focus on DSA')
      expect(store.planningState(now()).preferredGoalId).toBe(store.config().goals[0].id)
      advance(300)
      expect(store.planningState(now()).preferredGoalId).toBeUndefined()
    } finally {
      store.close()
    }
  })
  it('keeps the assignment and requested DSA goal through a revision and dismissal', async () => {
    const { store, app, planner, chat, taskId, now } = setup()
    const gsoc = randomUUID(),
      gsocTask = randomUUID()
    const config = store.config()
    config.goals[0] = { ...config.goals[0], title: 'DSA for interviews' }
    config.goals.push({ id: gsoc, title: 'Prepare for GSoC', priority: 4, deadline: '2026-12-05' })
    config.tasks.push({
      id: gsocTask,
      goalId: gsoc,
      title: 'Read issue #129',
      estimateMinutes: 60,
      deadline: null,
      status: 'todo',
    })
    store.saveConfig(config)
    chat.mockImplementation(async (messages, format) => {
      if (messages[0].content.startsWith('Identify new one-off')) {
        const context = JSON.parse(messages[1].content)
        expect(context.existingGoals).toContainEqual(
          expect.objectContaining({ title: 'DSA for interviews' }),
        )
        return {
          content: JSON.stringify({ tasks: context.update === update ? [draft] : [] }),
          durationMs: 1,
          tokens: 1,
        }
      }
      const context = JSON.parse(messages[1].content)
      if (context.preferredGoalId)
        expect(context.tasks.some((task: { id: string }) => task.id === gsocTask)).toBe(false)
      const work = Object.fromEntries(
        context.confirmedTemporaryTasks.map((task: { id: string }) => [
          task.id,
          { action: 'schedule', minutes: 60, reason: 'Your assignment is due.' },
        ]),
      )
      expect(JSON.stringify(format)).toContain('confirmedWork')
      return {
        content: JSON.stringify({
          kind: 'propose_plan',
          summary: 'Misleading: only do GSoC.',
          choices: [{ taskId, minutes: 45, reason: 'Make progress on DSA.' }],
          deferred: [],
          confirmedWork: work,
        }),
        durationMs: 1,
        tokens: 1,
      }
    })
    try {
      const proposed = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: proposed.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      const extractionCalls = chat.mock.calls.filter(([messages]) =>
        messages[0].content.startsWith('Identify new one-off'),
      ).length
      const revised = await planner.request(
        'I think i wanna squeez DSA instead of working on GSoC goals, as it is my higher priority',
        'plan',
        [],
        true,
      )
      expect(revised.decision.kind).toBe('propose_plan')
      expect(
        chat.mock.calls.filter(([messages]) =>
          messages[0].content.startsWith('Identify new one-off'),
        ),
      ).toHaveLength(extractionCalls)
      const preference = store.planningState(now()).preferredGoalId
      expect(preference).toBe(config.goals[0].id)
      const legacySuggestion = randomUUID()
      store.put('messages', {
        id: legacySuggestion,
        at: new Date(now()).toISOString(),
        role: 'mentor',
        text: 'Review new work.',
        details: {
          type: 'decision',
          payload: JSON.stringify({
            decision: {
              kind: 'propose_temporary_tasks',
              explanation: 'Review new work.',
              tasks: [{ ...draft, title: 'DSA for interviews' }],
              until: '2026-10-05T02:30:00Z',
            },
            inputRevision: store.planningRevision,
          }),
        },
      })
      const dismissed = await app.reviewTemporaryTasks({
        decisionId: legacySuggestion,
        action: 'dismiss',
        tasks: [],
      })
      expect(dismissed.planningError).toBeUndefined()
      const plan = store.get('plans', dismissed.result!.planId!)!
      expect(plan.temporaryTasks).toHaveLength(1)
      expect(
        plan.blocks.filter((block) => block.kind === 'focus').map((block) => block.title),
      ).toEqual(['Finish assignment', 'Finish assignment', 'Dynamic Programming'])
      expect(plan.summary).not.toContain('GSoC')
      expect(plan.summary).toContain('Dynamic Programming (45 minutes)')
      expect(store.planningState(now()).preferredGoalId).toBe(preference)
      expect(store.config()).toEqual(config)
    } finally {
      store.close()
    }
  })
  it('asks about preserved obligations if the model repeatedly omits them', async () => {
    const { store, app, planner, chat, taskId } = setup()
    try {
      const proposal = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: proposal.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      const plans = store.openPlans()
      chat.mockResolvedValue({
        content: JSON.stringify({
          kind: 'propose_plan',
          summary: 'Do DP.',
          choices: [{ taskId, minutes: 30, reason: 'DSA matters.' }],
          deferred: [],
        }),
        durationMs: 1,
        tokens: 1,
      })
      const result = await planner.request('Adjust the plan')
      expect(result.origin).toBe('guardrail')
      expect(result.decision).toMatchObject({
        kind: 'ask_question',
        question: expect.stringContaining('Finish assignment'),
      })
      expect(store.openPlans()).toEqual(plans)
    } finally {
      store.close()
    }
  })
  it('requires a disposition for every confirmed obligation in structured decoding', async () => {
    const { store, app, now } = setup()
    try {
      const proposal = await propose(app)
      await app.reviewTemporaryTasks({
        decisionId: proposal.result!.decisionId!,
        action: 'accept',
        tasks: [draft],
      })
      const state = store.planningState(now())
      const id = state.tasks.find((task) => task.goalId === null)!.id
      const format = JSON.stringify(modelFormat(state))
      expect(format).toContain('confirmedWork')
      expect(format).toContain(id)
      expect(() =>
        parsePlanningDecision(
          JSON.stringify({
            kind: 'propose_plan',
            summary: 'Do work.',
            choices: [],
            deferred: [],
            confirmedWork: {},
          }),
          state,
        ),
      ).toThrow()
      const parsed = parsePlanningDecision(
        JSON.stringify({
          kind: 'propose_plan',
          summary: 'Do work.',
          choices: [],
          deferred: [],
          confirmedWork: { [id]: { action: 'defer', reason: 'Please confirm a later slot.' } },
        }),
        state,
      )
      expect(parsed).toMatchObject({
        deferred: [{ taskId: id, reason: 'Please confirm a later slot.' }],
      })
    } finally {
      store.close()
    }
  })
  it('constrains source quotes to the update without changing capitalization or punctuation', () => {
    const text = 'Just woke up, i have an assignment due today.\nSubmit "draft 1" in college!'
    const schema = temporaryTaskExtractionSchemaForUpdate(text)
    expect(schema.parse({ tasks: [{ ...draft, sourceQuote: text }] }).tasks).toHaveLength(1)
    expect(() =>
      schema.parse({ tasks: [{ ...draft, sourceQuote: 'I have an assignment due today.' }] }),
    ).toThrow()
    expect(temporaryTaskExtractionSchemaForUpdate('').parse({ tasks: [] })).toEqual({ tasks: [] })
    expect(z.toJSONSchema(schema).properties?.tasks).toBeDefined()
  })
  it('offers grounded quote choices for the reported assignment update and still requires review', async () => {
    const { store, app, chat } = setup()
    const text =
      'Just woke up sometime before, i have an assignment due for today that i have to submit in college. I will be attending full college today. Plan my day for today accordingly'
    const quote = text
    chat.mockImplementation(async (_messages, format) => {
      const schema = format as {
        properties: { tasks: { items: { properties: { sourceQuote: { enum: string[] } } } } }
      }
      expect(schema.properties.tasks.items.properties.sourceQuote.enum).toContain(quote)
      expect(
        schema.properties.tasks.items.properties.sourceQuote.enum.every((source) =>
          text.includes(source),
        ),
      ).toBe(true)
      return {
        content: JSON.stringify({
          tasks: [{ ...draft, estimateMinutes: null, sourceQuote: quote }],
        }),
        durationMs: 1,
        tokens: 1,
      }
    })
    try {
      const before = store.config()
      const response = await app.checkInAndPlan({
        text,
        until: '02:30',
        energy: 'okay',
        busyStart: '',
        busyEnd: '',
      })
      expect(response.planningError).toBeUndefined()
      expect(response.result?.decision).toMatchObject({
        kind: 'propose_temporary_tasks',
        tasks: [{ sourceQuote: quote, estimateMinutes: null }],
      })
      expect(store.config()).toEqual(before)
      expect(store.openPlans()).toEqual([])
      expect(chat).toHaveBeenCalledTimes(1)
    } finally {
      store.close()
    }
  })
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
