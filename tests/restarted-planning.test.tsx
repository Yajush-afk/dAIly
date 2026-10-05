// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { defaultProfile } from '../src/shared/state'
import { resolveDayIntent } from '../src/shared/day-intent'
import { useConversationController } from '../src/renderer/src/WorkspaceContext'
import type { DesktopBridge } from '../src/shared/contracts'

afterEach(() => {
  delete window.dAIly
  localStorage.clear()
})
function setup() {
  const store = new Store(':memory:'),
    now = Date.parse('2026-10-05T03:00:00Z')
  const goalId = randomUUID(),
    taskId = randomUUID()
  store.saveConfig({
    profile: { ...defaultProfile, timezone: 'UTC', bedtime: '23:00', focusMinutes: 60 },
    goals: [{ id: goalId, title: 'DSA for interviews', priority: 5, deadline: null }],
    tasks: [
      { id: taskId, goalId, title: 'DP', estimateMinutes: 600, deadline: null, status: 'todo' },
    ],
    timetable: [],
  })
  store.put('messages', {
    id: randomUUID(),
    at: new Date(now).toISOString(),
    role: 'mentor',
    text: 'I will schedule 60 minutes for DP. Can you confirm that I should proceed?',
    details: {
      type: 'decision',
      payload: JSON.stringify({ decision: { kind: 'respond', explanation: 'Schedule DP?' } }),
    },
  })
  return { store, now, taskId }
}
describe('day planning after restart', () => {
  it('routes Adjust and confirmation messages from a freshly mounted conversation controller', async () => {
    const { store } = setup()
    const askMentor = vi.fn().mockResolvedValue({
      decision: { kind: 'ask_question', question: 'Test response' },
      revision: 0,
      durationMs: 0,
    })
    window.dAIly = { askMentor } as unknown as DesktopBridge
    try {
      for (const text of [
        'Please adjust this plan: I want DSA instead of GSoC prep',
        'yes',
        'proceed',
        'yes create the plan',
        'Works',
      ]) {
        const hook = renderHook(() => useConversationController(store.snapshot()))
        act(() => hook.result.current.setNote(text))
        await act(async () => {
          await hook.result.current.request()
        })
        expect(askMentor).toHaveBeenLastCalledWith(text, 'plan')
        hook.unmount()
      }
      expect(
        resolveDayIntent('Why did you change the plan?', 'conversation', store.snapshot()),
      ).toBe('conversation')
      expect(resolveDayIntent('Do not update the plan', 'conversation', store.snapshot())).toBe(
        'conversation',
      )
    } finally {
      store.close()
    }
  })
  it('creates a reviewable proposal even if the caller mistakenly sends conversation intent', async () => {
    const { store, now, taskId } = setup()
    const chat = vi.fn().mockImplementation(async (messages, format) => {
      if (messages[0].content.startsWith('Identify new one-off'))
        return { content: '{"tasks":[]}', durationMs: 1, tokens: 1 }
      expect(JSON.stringify(format)).not.toContain('"respond"')
      expect(JSON.stringify(format)).not.toContain('"ask_question"')
      return {
        content: JSON.stringify({
          kind: 'propose_plan',
          summary: 'Describe a schedule.',
          choices: [{ taskId, minutes: 60, reason: 'Prioritize DSA.' }],
          deferred: [],
        }),
        durationMs: 1,
        tokens: 1,
      }
    })
    try {
      for (const text of [
        'Please adjust this plan: I want DSA from my goals instead of GSoC prep',
        'yes create the plan',
      ]) {
        const planner = new Planner(store, { chat }, () => now)
        const result = await planner.request(text, 'conversation')
        expect(result.planId).toBeDefined()
        expect(store.get('plans', result.planId!)?.status).toBe('proposed')
        expect(result.decision.kind).toBe('propose_plan')
      }
    } finally {
      store.close()
    }
  })
  it('repairs a confirmation-only reply instead of accepting it as a plan', async () => {
    const { store, now, taskId } = setup()
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          kind: 'ask_question',
          question: 'Can you confirm this 60 minute plan?',
        }),
        durationMs: 1,
        tokens: 1,
      })
      .mockResolvedValue({
        content: JSON.stringify({
          kind: 'propose_plan',
          summary: 'Plan DP.',
          choices: [{ taskId, minutes: 60, reason: 'Make progress.' }],
          deferred: [],
        }),
        durationMs: 1,
        tokens: 1,
      })
    try {
      const result = await new Planner(store, { chat }, () => now).request(
        'proceed',
        'conversation',
      )
      expect(result.planId).toBeDefined()
      expect(chat).toHaveBeenCalledTimes(2)
      expect(store.openPlans()[0].status).toBe('proposed')
      const confirmed = await new Planner(store, { chat }, () => now).request('yes', 'conversation')
      expect(confirmed.planId).toBe(result.planId)
      expect(chat).toHaveBeenCalledTimes(2)
      expect(store.openPlans()[0].status).toBe('proposed')
      expect(store.dailyConversation().at(-1)?.text).toContain('Apply plan')
    } finally {
      store.close()
    }
  })
})
