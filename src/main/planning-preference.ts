import type { Goal, Snapshot } from '../shared/state'
import { DateTime } from 'luxon'

export function isUrgentTask(
  state: Snapshot,
  task: Snapshot['tasks'][number],
  now: number,
): boolean {
  const tomorrow = DateTime.fromMillis(now, { zone: state.profile.timezone })
    .plus({ days: 1 })
    .toISODate()!
  const deadline = [task.deadline, state.goals.find((goal) => goal.id === task.goalId)?.deadline]
    .filter((date): date is string => Boolean(date))
    .sort()[0]
  return Boolean(deadline && deadline <= tomorrow)
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) || []
export function mentionsGoal(text: string, goal: Goal): boolean {
  const normalized = words(text).join(' ')
  if (normalized.includes(words(goal.title).join(' '))) return true
  return goal.title
    .split(/\s+/)
    .some((word) => /[A-Z].*[A-Z]/.test(word) && words(text).includes(word.toLowerCase()))
}
export function requestedGoal(text: string, goals: Goal[]): string | undefined {
  if (/\b(don't|do not|avoid|stop)\b.*\b(prioriti[sz]e|focus|prefer)\b/i.test(text))
    return undefined
  if (
    !/\b(prioriti[sz]e|prefer|focus|squeez\w*|higher priority|instead of|rather than)\b/i.test(text)
  )
    return undefined
  // The work before "instead of" is requested; the work after it is displaced.
  const requested = text.split(/\b(?:instead of|rather than)\b/i)[0]
  const candidates = goals.filter((goal) => mentionsGoal(requested, goal))
  return candidates.length === 1 ? candidates[0].id : undefined
}
export function isGoalReference(title: string, goals: Goal[]): boolean {
  const tokens = words(title)
    .filter(
      (word) =>
        !/^(squeez\w*|work|working|on|focus|prioritize|prioritise|add|goal|goals)$/.test(word),
    )
    .map((word) => word.replace(/s$/, ''))
  return (
    tokens.length > 0 &&
    goals.some((goal) => {
      const allowed = words(goal.title).map((word) => word.replace(/s$/, ''))
      return tokens.every((word) => allowed.includes(word))
    })
  )
}
