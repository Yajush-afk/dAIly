import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { Sessions } from '../src/main/sessions'
import { DayApplication } from '../src/main/application'
import { defaultProfile } from '../src/shared/state'
import type { OllamaClient } from '../src/main/ollama'

function fixture() {
  const store = new Store(':memory:')
  const goalId = randomUUID(),
    taskId = randomUUID(),
    doneId = randomUUID()
  store.saveConfig({
    profile: defaultProfile,
    goals: [{ id: goalId, title: 'DSA', priority: 5, deadline: '2027-03-01' }],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Recursion',
        status: 'todo',
        deadline: null,
        estimateMinutes: null,
      },
      { id: doneId, goalId, title: 'Arrays', status: 'done', deadline: null, estimateMinutes: 60 },
    ],
    timetable: [],
  })
  const roadmap = {
    kind: 'roadmap',
    explanation: 'Start with recursion, then build on it.',
    tasks: [{ id: taskId, title: 'Recursion', deadline: '2026-11-01', estimateMinutes: 600 }],
    priority: 5,
    preferredDailyMinutes: 180,
    deadline: '2027-03-01',
  }
  const chat = vi.fn<Pick<OllamaClient, 'chat'>['chat']>()
  const application = new DayApplication(store, new Planner(store, { chat }), new Sessions(store))
  return { store, goalId, taskId, doneId, roadmap, chat, application }
}
const response = (content: string) => ({ content, durationMs: 1, tokens: 1 })
describe('goal response recovery', () => {
  it.each([
    'How should I structure learning ML?',
    'I want to learn "Python", "Supervised Learning", and "Practice on Kaggle".\nHow should I structure this?',
    'My notes use a backslash: C:\\learning\\ML',
  ])('discusses an empty goal without losing message content: %s', async (text) => {
    const { store, goalId, chat, application } = fixture()
    const config = store.config()
    store.saveConfig({
      ...config,
      goals: [
        {
          ...config.goals[0],
          title: 'Learning ML',
          preferredDailyMinutes: null,
          notes: 'Flexible learning time.',
        },
      ],
      tasks: [],
    })
    const roadmap = {
      kind: 'roadmap',
      explanation: 'Start with Python foundations, then supervised learning.',
      tasks: [{ id: null, title: 'Python foundations', deadline: null, estimateMinutes: 600 }],
      priority: 5,
      preferredDailyMinutes: null,
      deadline: null,
    }
    chat.mockResolvedValue(response(JSON.stringify(roadmap)))
    try {
      const result = await application.discussGoal({ goalId, text })
      expect(result.decision).toEqual(roadmap)
      expect(chat).toHaveBeenCalledTimes(1)
      expect(JSON.parse(chat.mock.calls[0][0].at(-1)!.content)).toMatchObject({
        currentRequest: text,
        tasks: [],
      })
      expect(store.config().tasks).toEqual([])
      const saved = application.approveRoadmap({
        decisionId: result.decisionId,
        tasks: roadmap.tasks,
        priority: roadmap.priority,
        preferredDailyMinutes: null,
        deadline: null,
      })
      expect(saved.tasks).toHaveLength(1)
      expect(saved.tasks[0].title).toBe('Python foundations')
    } finally {
      store.close()
    }
  })
  it.each(['request', 'goal', 'role', 'json'])(
    'rejects a genuinely mismatched context: %s',
    async (fault) => {
      const { store, goalId, chat } = fixture()
      const text = 'Structure my ML goal.'
      const planner = new Planner(store, { chat })
      const content =
        fault === 'json'
          ? '{'
          : JSON.stringify({
              goal: { id: fault === 'goal' ? randomUUID() : goalId },
              currentRequest: fault === 'request' ? text + ' something else' : text,
            })
      try {
        await expect(
          planner.discussGoal(
            { goalId, text },
            store.snapshot(),
            [{ role: fault === 'role' ? 'assistant' : 'user', content }],
            {},
          ),
        ).rejects.toThrow('Goal discussion context is incomplete.')
        expect(chat).not.toHaveBeenCalled()
      } finally {
        store.close()
      }
    },
  )
  it('repairs malformed JSON once and preserves completed work when the roadmap is accepted', async () => {
    const { store, goalId, doneId, roadmap, chat, application } = fixture()
    const completed = store.snapshot().tasks.find((task) => task.id === doneId)
    chat
      .mockResolvedValueOnce(response('{"kind":"roadmap",}'))
      .mockResolvedValueOnce(response(JSON.stringify(roadmap)))
    const result = await application.discussGoal({
      goalId,
      text: 'I will follow your recommended order.',
    })
    expect(result.decision.kind).toBe('roadmap')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[0][2]?.maxTokens).toBe(1536)
    expect(chat.mock.calls[1][0].at(-1)?.content).toContain('previous response was invalid')
    expect(chat.mock.calls[1][0].at(-2)).toEqual({
      role: 'assistant',
      content: '{"kind":"roadmap",}',
    })
    expect(store.snapshot().messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(store.snapshot().tasks.find((task) => task.id !== doneId)?.deadline).toBeNull()
    const saved = application.approveRoadmap({
      decisionId: result.decisionId,
      tasks: roadmap.tasks,
      priority: roadmap.priority,
      preferredDailyMinutes: roadmap.preferredDailyMinutes,
      deadline: roadmap.deadline,
    })
    expect(saved.tasks.find((task) => task.id === doneId)).toEqual(completed)
    expect(saved.goals[0].preferredDailyMinutes).toBe(180)
    expect(saved.tasks.find((task) => task.id !== doneId)).toMatchObject(roadmap.tasks[0])
    expect(saved.messages.at(-1)?.details).toMatchObject({
      type: 'changes-accept',
      payload: JSON.stringify({ decisionId: result.decisionId }),
    })
    expect(
      store.goalConversation(goalId).some((message) => message.details?.type === 'changes-accept'),
    ).toBe(false)
    store.close()
  })
  it('repairs an unknown task reference instead of accepting it', async () => {
    const { store, goalId, roadmap, chat, application } = fixture()
    chat
      .mockResolvedValueOnce(
        response(
          JSON.stringify({ ...roadmap, tasks: [{ ...roadmap.tasks[0], id: randomUUID() }] }),
        ),
      )
      .mockResolvedValueOnce(response(JSON.stringify(roadmap)))
    await expect(
      application.discussGoal({ goalId, text: 'Recommend the order.' }),
    ).resolves.toMatchObject({ decision: { kind: 'roadmap' } })
    expect(chat).toHaveBeenCalledTimes(2)
    store.close()
  })
  it('keeps the conversation and saved goal after two invalid responses', async () => {
    const { store, goalId, chat, application } = fixture()
    const before = store.config()
    chat.mockResolvedValue(response('{'))
    await expect(
      application.discussGoal({ goalId, text: 'Please recommend an order.' }),
    ).rejects.toThrow('conversation and saved goal are intact')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(store.config()).toEqual(before)
    expect(store.goalConversation(goalId).at(-1)?.text).toBe('Please recommend an order.')
    store.close()
  })
  it('does not drop an unfinished topic from a model roadmap', async () => {
    const { store, goalId, roadmap, chat, application } = fixture()
    chat
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            ...roadmap,
            tasks: [{ ...roadmap.tasks[0], id: null, title: 'New practice' }],
          }),
        ),
      )
      .mockResolvedValueOnce(response(JSON.stringify(roadmap)))
    const result = await application.discussGoal({
      goalId,
      text: 'Choose an order for all my topics.',
    })
    expect(result.decision).toEqual(roadmap)
    expect(chat.mock.calls[1][0].at(-1)?.content).toContain('Do not omit a topic')
    store.close()
  })
  it('does not retry cancellation or connection errors', async () => {
    const { store, goalId, chat, application } = fixture()
    chat.mockRejectedValue(new Error('Request cancelled'))
    await expect(application.discussGoal({ goalId, text: 'Recommend an order.' })).rejects.toThrow(
      'cancelled',
    )
    expect(chat).toHaveBeenCalledTimes(1)
    store.close()
  })
  it('repairs an impossible calendar date using the failed response', async () => {
    const { store, goalId, roadmap, chat, application } = fixture()
    const invalid = JSON.stringify({
      ...roadmap,
      tasks: [{ ...roadmap.tasks[0], deadline: '2027-02-29' }],
    })
    chat
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(JSON.stringify(roadmap)))
    await expect(
      application.discussGoal({ goalId, text: 'Draft the roadmap.' }),
    ).resolves.toMatchObject({ decision: roadmap })
    expect(chat.mock.calls[1][0].at(-2)?.content).toBe(invalid)
    expect(chat.mock.calls[1][0].at(-1)?.content).toContain('real calendar dates')
    expect(chat.mock.calls[1][0].at(-1)?.content).toContain('2027-02 has only 28 days')
    store.close()
  })
})
