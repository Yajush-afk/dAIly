// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsEditor, ProfileEditor } from '../src/renderer/src/Editors'
import { GoalDiscussion } from '../src/renderer/src/GoalDiscussion'
import { defaultProfile, type Config, type Snapshot } from '../src/shared/state'

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
})
afterEach(() => {
  delete window.dAIly
})
function fixture(): Snapshot {
  const goals = ['DSA', 'ML'].map((title) => ({
    id: randomUUID(),
    title,
    priority: 3,
    deadline: null,
  }))
  return {
    revision: 0,
    profile: {
      ...defaultProfile,
      bedtime: '01:00',
      wakeTime: '08:30',
      quietStart: '22:00',
      quietEnd: '07:00',
    },
    goals,
    tasks: [
      {
        id: randomUUID(),
        goalId: goals[0].id,
        title: 'Recursion',
        status: 'todo',
        estimateMinutes: null,
        deadline: '2026-11-01',
      },
    ],
    timetable: [],
    checkIns: [],
    plans: [],
    sessions: [],
    messages: [],
  }
}
describe('goal and preference interactions', () => {
  it('shows matching quiet hours immediately and follows later sleep edits', async () => {
    const state = fixture(),
      save = vi.fn<(config: Config) => Promise<boolean>>().mockResolvedValue(true)
    render(
      <ProfileEditor
        state={state}
        save={save}
        busy={false}
        importSchedule={async () => undefined}
      />,
    )
    await userEvent.click(screen.getByLabelText('Quiet hours match my sleep time'))
    expect(screen.getByLabelText('Quiet hours start')).toHaveValue('01:00')
    expect(screen.getByLabelText('Quiet hours end')).toHaveValue('08:30')
    fireEvent.change(screen.getByLabelText('Usual bedtime'), { target: { value: '23:30' } })
    fireEvent.change(screen.getByLabelText('Usual wake time'), { target: { value: '07:45' } })
    expect(screen.getByLabelText('Quiet hours start')).toHaveValue('23:30')
    expect(screen.getByLabelText('Quiet hours end')).toHaveValue('07:45')
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(save.mock.calls[0][0].profile).toMatchObject({
      quietStart: '23:30',
      quietEnd: '07:45',
      quietDuringSleep: true,
    })
  })
  it('navigates individual goals, expands subtasks, and creates a goal through one modal save', async () => {
    const state = fixture(),
      save = vi.fn<(config: Config) => Promise<boolean>>().mockResolvedValue(true)
    render(
      <GoalsEditor state={state} save={save} busy={false} navigate={() => {}} onDirty={() => {}} />,
    )
    const user = userEvent.setup()
    expect(screen.getByLabelText('Goal')).toHaveValue('DSA')
    expect(screen.getByRole('button', { name: 'Previous goal' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next goal' }))
    expect(screen.getByLabelText('Goal')).toHaveValue('ML')
    expect(screen.getByRole('button', { name: 'Next goal' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'My Goals' }))
    await user.click(screen.getByText('DSA'))
    expect(screen.getByText('Recursion · 2026-11-01')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'New Goal' }))
    const dialog = screen.getByRole('dialog', { name: 'New goal' })
    await user.type(within(dialog).getByLabelText('Goal name'), 'Internships')
    await user.click(within(dialog).getByRole('button', { name: 'Create goal' }))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].goals.map((goal) => goal.title)).toEqual([
      'DSA',
      'ML',
      'Internships',
    ])
    expect(screen.getByLabelText('Goal')).toHaveValue('Internships')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add sub tasks' })).toBeInTheDocument()
  })
  it('uses Shift+Enter for a newline and Enter to send the goal conversation once', async () => {
    const state = fixture(),
      discussGoal = vi.fn().mockResolvedValue({
        decisionId: randomUUID(),
        goalId: state.goals[0].id,
        inputRevision: 0,
        decision: { kind: 'discuss', explanation: 'Start with the foundations.' },
      })
    Object.defineProperty(window, 'dAIly', { configurable: true, value: { discussGoal } })
    const save = vi.fn().mockResolvedValue(true)
    render(
      <GoalDiscussion
        goal={state.goals[0]}
        tasks={state.tasks}
        state={state}
        save={save}
        onSaved={() => {}}
      />,
    )
    const user = userEvent.setup()
    const message = screen.getByLabelText('Your message')
    await user.type(message, 'Recommend an order.')
    await user.keyboard('{Shift>}{Enter}{/Shift}Then draft it.')
    expect(message).toHaveValue('Recommend an order.\nThen draft it.')
    expect(discussGoal).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(discussGoal).toHaveBeenCalledTimes(1)
    expect(discussGoal).toHaveBeenCalledWith({
      goalId: state.goals[0].id,
      text: 'Recommend an order.\nThen draft it.',
    })
    expect(message).toHaveValue('')
  })
  it('can save removal of the last goal after the editor becomes empty', async () => {
    const state = fixture(),
      save = vi.fn<(config: Config) => Promise<boolean>>().mockResolvedValue(true)
    render(
      <GoalsEditor state={state} save={save} busy={false} navigate={() => {}} onDirty={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove goal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove goal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save goals' }))
    expect(save.mock.calls[0][0]).toMatchObject({ goals: [], tasks: [] })
  })
})
