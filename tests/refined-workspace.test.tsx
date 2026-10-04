// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/renderer/src/App'
import { defaultProfile, type Snapshot } from '../src/shared/state'
import { orderedGoals } from '../src/renderer/src/GoalsPage'
function fixture(): Snapshot {
  const goalId = randomUUID(),
    taskId = randomUUID(),
    now = Date.now()
  return {
    revision: 0,
    planningRevision: 0,
    profile: { ...defaultProfile, onboardingComplete: true },
    goals: [
      { id: goalId, title: 'DSA', priority: 5, deadline: '2027-03-01', preferredDailyMinutes: 180 },
    ],
    tasks: [
      {
        id: taskId,
        goalId,
        title: 'Recursion',
        deadline: '2026-11-01',
        estimateMinutes: 600,
        status: 'todo',
      },
    ],
    timetable: [],
    checkIns: [],
    sessions: [],
    messages: [],
    plans: [
      {
        id: randomUUID(),
        createdAt: new Date(now).toISOString(),
        contextRevision: 0,
        inputRevision: 0,
        status: 'proposed',
        summary: 'A short block fits.',
        blocks: [
          {
            id: randomUUID(),
            taskId,
            kind: 'focus',
            title: 'Recursion',
            start: new Date(now).toISOString(),
            end: new Date(now + 30 * 60000).toISOString(),
            reason: 'Interview preparation matters.',
          },
        ],
        deferred: [],
      },
    ],
  }
}
function bridge(state: Snapshot) {
  Object.defineProperty(window, 'dAIly', {
    configurable: true,
    value: {
      getState: async () => state,
      onState: () => () => {},
      getDashboardSummary: async () => ({
        date: '2026-10-04',
        yesterday: { date: '2026-10-03', seconds: 0, sessions: 0, recentWork: [] },
        pendingOutcomes: 0,
      }),
      saveConfig: vi.fn().mockResolvedValue(state),
    },
  })
}
afterEach(() => {
  delete window.dAIly
  localStorage.clear()
})
describe('refined daily workspace', () => {
  it('keeps a proposal separate from focus actions', async () => {
    bridge(fixture())
    render(<App />)
    await screen.findByText('A short block fits.')
    expect(screen.getByRole('button', { name: 'Apply plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start focus' })).not.toBeInTheDocument()
  })
  it('reads goal details and edits through a dialog, preserving conversation drafts between modes', async () => {
    bridge(fixture())
    render(<App />)
    const user = userEvent.setup()
    await screen.findByText('A short block fits.')
    const dayText = screen.getByRole('textbox', { name: 'Your message' })
    await user.type(dayText, 'I got home late.')
    await user.click(screen.getByRole('button', { name: 'Goals' }))
    await user.click(screen.getByRole('button', { name: 'Open goal: DSA' }))
    expect(screen.queryByLabelText('Goal name')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit goal' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit goal' })
    expect(within(dialog).getByLabelText('Preferred time per day, minutes')).toHaveValue(180)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discuss this goal' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Your message' }),
      'How should I approach recursion?',
    )
    await user.click(screen.getByRole('combobox', { name: 'Conversation mode' }))
    await user.click(screen.getByRole('option', { name: 'Your day' }))
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('I got home late.')
    await user.click(screen.getByRole('combobox', { name: 'Conversation mode' }))
    await user.click(screen.getByRole('option', { name: 'Discuss a goal' }))
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue(
      'How should I approach recursion?',
    )
  })
  it('orders priority goals deterministically without pretending priorities are deadlines', () => {
    const base = fixture().goals[0]
    const goals = [
      { ...base, title: 'ML', priority: 3, deadline: '2026-10-05' },
      { ...base, title: 'GSoC', deadline: '2027-02-01' },
      { ...base, title: 'DSA' },
      { ...base, title: 'Internships', deadline: null },
    ]
    expect(orderedGoals(goals).map((goal) => goal.title)).toEqual([
      'GSoC',
      'DSA',
      'Internships',
      'ML',
    ])
  })
})
