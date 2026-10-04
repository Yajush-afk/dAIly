import type { Snapshot } from '../shared/state'
import type { Decision } from '../shared/planner'
import { planningLimits } from '../shared/planning-limits'
import { currentCheckIn, availableIntervals } from './scheduler'
export function decisionConstraints(
  state: Snapshot,
  now: number,
): {
  maxBlockMinutes: number
  repeatedObstacles: {
    taskId: string
    interruptions: number
    deferredDays: number
    reason: string
  }[]
} {
  const checkIn = currentCheckIn(state, now)
  const low = checkIn?.energy === 'low'
  const available = Math.max(
    0,
    ...availableIntervals(state, now).map((i) => Math.floor((i.end - i.start) / 60000)),
  )
  return {
    maxBlockMinutes: Math.min(
      state.profile.focusMinutes,
      available,
      low ? planningLimits.lowEnergyMinutes : planningLimits.maximumBlockMinutes,
    ),
    repeatedObstacles: state.tasks
      .filter((t) => t.status === 'todo')
      .flatMap((t) => {
        const interrupted = state.sessions.filter(
          (s) =>
            s.taskId === t.id &&
            s.outcome === 'interrupted' &&
            Date.parse(s.startedAt) >= now - 7 * 86400000,
        )
        const deferred = state.plans.filter(
          (p) =>
            Date.parse(p.createdAt) >= now - 7 * 86400000 &&
            p.deferred.some((d) => d.taskId === t.id),
        )
        const deferredDays = new Set(
          deferred.map((p) =>
            new Intl.DateTimeFormat('en-CA', { timeZone: state.profile.timezone }).format(
              new Date(p.createdAt),
            ),
          ),
        ).size
        return interrupted.length >= 3 || deferredDays >= 3
          ? [
              {
                taskId: t.id,
                interruptions: interrupted.length,
                deferredDays,
                reason: (
                  interrupted.at(-1)?.interruption ||
                  deferred.at(-1)?.deferred.find((d) => d.taskId === t.id)?.reason ||
                  ''
                ).slice(0, 120),
              },
            ]
          : []
      }),
  }
}

export function orderPlanChoices(state: Snapshot, decision: Decision): Decision {
  if (decision.kind !== 'propose_plan') return decision
  const tasks = new Map(state.tasks.map((task) => [task.id, task]))
  const goals = new Map(state.goals.map((goal) => [goal.id, goal]))
  const deadline = (taskId: string): string => {
    const task = tasks.get(taskId)
    if (!task) return '9999'
    return (
      [task.deadline, goals.get(task.goalId)?.deadline]
        .filter((date): date is string => Boolean(date))
        .sort()[0] || '9999'
    )
  }
  return {
    ...decision,
    choices: [...decision.choices].sort((a, b) => {
      const byDeadline = deadline(a.taskId).localeCompare(deadline(b.taskId))
      if (byDeadline) return byDeadline
      return (
        (goals.get(tasks.get(b.taskId)?.goalId || '')?.priority || 1) -
        (goals.get(tasks.get(a.taskId)?.goalId || '')?.priority || 1)
      )
    }),
  }
}

export function validateDecision(state: Snapshot, decision: Decision, now: number): void {
  const constraints = decisionConstraints(state, now)
  if (
    constraints.maxBlockMinutes < planningLimits.minimumBlockMinutes &&
    (decision.kind === 'propose_plan' || decision.kind === 'propose_changes')
  )
    throw new Error(
      'No useful time remains today. Recommend rest or stopping, or ask a relevant clarification.',
    )
  if (decision.kind === 'propose_plan') {
    if (decision.choices.some((c) => c.minutes > constraints.maxBlockMinutes))
      throw new Error(
        `Each block must be at most ${constraints.maxBlockMinutes} minutes given current availability and energy.`,
      )
    if (
      decision.choices.some(
        (c) =>
          constraints.repeatedObstacles.some((o) => o.taskId === c.taskId) &&
          c.minutes >= (state.tasks.find((t) => t.id === c.taskId)?.estimateMinutes || 0),
      )
    )
      throw new Error(
        'Repeated interruptions need a different approach. Ask about the obstacle, suggest a smaller task, or defer it instead of repeating its full estimate.',
      )
  }
  if (
    decision.kind === 'propose_changes' &&
    decision.tasks.some((t) => !state.goals.some((g) => g.id === t.goalId))
  )
    throw new Error('Suggested task has an unknown goal')
  if (decision.kind === 'propose_changes') {
    const normalize = (title: string): string =>
      title
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    if (
      decision.tasks.some((suggested) =>
        state.tasks.some(
          (task) =>
            task.goalId === suggested.goalId &&
            normalize(task.title) === normalize(suggested.title),
        ),
      )
    )
      throw new Error('Suggested tasks must be distinct from existing tasks, not renamed copies.')
    if (
      (decision.preferences.focusMinutes !== undefined &&
        decision.preferences.focusMinutes === state.profile.focusMinutes) ||
      (decision.preferences.breakMinutes !== undefined &&
        decision.preferences.breakMinutes === state.profile.breakMinutes)
    )
      throw new Error('Suggested preferences must change the current setting.')
  }
}
