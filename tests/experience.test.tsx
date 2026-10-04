// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/renderer/src/App'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { DayApplication } from '../src/main/application'
import { Sessions } from '../src/main/sessions'
import { defaultProfile, type Snapshot } from '../src/shared/state'
import type { DesktopBridge } from '../src/shared/contracts'
import { MODEL } from '../src/shared/ai'

afterEach(() => {
  delete window.dAIly
  localStorage.clear()
})
describe('usable planning cycle', () => {
  it('accepts a real proposal, runs controls, records partial work, and adapts', async () => {
    const store = new Store(':memory:'),
      goalId = randomUUID(),
      taskId = randomUUID()
    store.saveConfig({
      profile: {
        ...defaultProfile,
        timezone: 'UTC',
        bedtime: '23:59',
        wakeTime: '00:00',
        onboardingComplete: true,
      },
      goals: [{ id: goalId, title: 'DSA', priority: 2, deadline: null }],
      tasks: [
        {
          id: taskId,
          goalId,
          title: 'Read a graph example',
          estimateMinutes: 5,
          deadline: null,
          status: 'todo',
        },
      ],
      timetable: [],
    })
    let calls = 0
    const planner = new Planner(store, {
      chat: async () => ({
        content: JSON.stringify({
          kind: 'propose_plan',
          summary:
            ++calls === 1 ? 'One small step fits.' : 'Build on your reported partial progress.',
          choices: [{ taskId, minutes: 5, reason: 'A concrete next step.' }],
          deferred: [],
        }),
        durationMs: 1,
        tokens: 1,
      }),
    })
    const sessions = new Sessions(store)
    const listeners = new Set<(state: Snapshot) => void>()
    const changed = (): Snapshot => {
      const s = store.snapshot()
      listeners.forEach((listener) => listener(s))
      return s
    }
    const application = new DayApplication(store, planner, sessions, Date.now, () => {
      changed()
    })
    const api: DesktopBridge = {
      platform: 'win32',
      getVersion: async () => '0.1.0',
      getState: async () => store.snapshot(),
      saveConfig: async (config) => {
        store.saveConfig(config)
        return changed()
      },
      saveCheckIn: async (c) => {
        store.put('checkIns', c)
        return changed()
      },
      onState: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      modelStatus: async () => ({ ready: true, running: true, model: MODEL }),
      downloadModel: async () => {},
      cancelModel: async () => {},
      openOllamaDownload: async () => {},
      onDownload: () => () => {},
      askMentor: async (text) => {
        const r = await planner.request(text)
        changed()
        return r
      },
      discussGoal: async () => {
        throw new Error('Goal discussion is not used in this scenario')
      },
      approveRoadmap: async () => store.snapshot(),
      importSchedule: async () => undefined,
      confirmSchedule: async () => store.snapshot(),
      acceptPlan: async (id) => {
        planner.accept(id)
        return changed()
      },
      sessionAction: async (command) => {
        sessions.act(command)
        return changed()
      },
      checkInAndPlan: (input) => application.checkInAndPlan(input),
      recordOutcome: (command) => application.recordOutcome(command),
      approveChanges: async (review) => application.approveChanges(review),
      getHistory: async (query) => store.history(query),
      exportData: async () => ({ cancelled: true }),
    }
    window.dAIly = api
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'What fits today?' })
    await user.selectOptions(screen.getByLabelText('Energy'), 'okay')
    await user.type(screen.getByLabelText('What changed?'), 'I have a short evening.')
    await user.click(screen.getByRole('button', { name: 'Plan with this update' }))
    await user.click(await screen.findByRole('button', { name: 'Accept plan' }))
    await user.click(await screen.findByRole('button', { name: 'Start focus session' }))
    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    await user.click(await screen.findByRole('button', { name: 'Resume' }))
    await user.click(await screen.findByRole('button', { name: 'Finish early' }))
    expect(store.snapshot().tasks[0].status).toBe('todo')
    const minutes = await screen.findByLabelText('Actual focus minutes')
    await user.clear(minutes)
    await user.type(minutes, '3')
    await user.type(screen.getByLabelText('Actual work'), 'Read the first example.')
    await user.click(screen.getByRole('button', { name: 'Save outcome and reconsider today' }))
    await screen.findAllByText('Build on your reported partial progress.')
    expect(store.snapshot().sessions[0].outcome).toBe('partial')
    expect(store.snapshot().sessions[0].elapsedSeconds).toBe(180)
    expect(store.snapshot().tasks[0].status).toBe('todo')
    expect(calls).toBe(2)
    expect(store.snapshot().messages.some((m) => m.details?.type === 'session-action')).toBe(true)
    store.close()
  })
})
