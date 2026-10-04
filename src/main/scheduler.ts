import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import type { Decision } from '../shared/planner'
import type { CheckIn, Plan, Snapshot } from '../shared/state'
import { planningLimits } from '../shared/planning-limits'

export interface Interval {
  start: number
  end: number
}
export function currentCheckIn(state: Snapshot, now: number): CheckIn | undefined {
  const p = state.profile,
    [hour, minute] = p.wakeTime.split(':').map(Number)
  const planningDay = (at: number): string | null =>
    DateTime.fromMillis(at, { zone: p.timezone })
      .minus({ minutes: hour * 60 + minute })
      .toISODate()
  return [...state.checkIns]
    .sort((a, b) => b.at.localeCompare(a.at))
    .find(
      (c) =>
        Date.parse(c.at) <= now &&
        now - Date.parse(c.at) < 18 * 3600000 &&
        planningDay(Date.parse(c.at)) === planningDay(now),
    )
}
export function availableIntervals(state: Snapshot, now: number): Interval[] {
  const p = state.profile
  const local = DateTime.fromMillis(now, { zone: p.timezone })
  const at = (day: DateTime, time: string): DateTime => {
    const [hour, minute] = time.split(':').map(Number)
    return day.set({ hour, minute, second: 0, millisecond: 0 })
  }
  const bedtimeToday = at(local, p.bedtime)
  const wake = at(local, p.wakeTime)
  // A late bedtime belongs to the evening that started before midnight.
  const cutoff =
    p.bedtime < p.wakeTime && local >= wake ? bedtimeToday.plus({ days: 1 }) : bedtimeToday
  const fresh = currentCheckIn(state, now)
  const end = Math.min(
    cutoff.toMillis(),
    fresh?.availableUntil ? Date.parse(fresh.availableUntil) : cutoff.toMillis(),
  )
  if (end <= now) return []
  const busy: Interval[] = (fresh?.busy || []).map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }))
  for (let day = local.startOf('day'); day.toMillis() < end; day = day.plus({ days: 1 })) {
    const overrides = state.timetable.filter((t) => t.date === day.toISODate())
    const entries = overrides.length
      ? overrides
      : state.timetable.filter((t) => !t.date && t.weekday === day.weekday % 7)
    for (const t of entries.filter((t) => !t.cancelled))
      busy.push({
        start: at(day, t.start).minus({ minutes: p.commuteMinutes }).toMillis(),
        end: at(day, t.end).plus({ minutes: p.commuteMinutes }).toMillis(),
      })
  }
  let cursor = now
  const free: Interval[] = []
  for (const b of busy.sort((a, b) => a.start - b.start)) {
    if (b.end <= cursor || b.start >= end) continue
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(end, b.start) })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < end) free.push({ start: cursor, end })
  return free
}

export function schedule(
  state: Snapshot,
  decision: Extract<Decision, { kind: 'propose_plan' }>,
  now: number,
): Plan {
  if (decision.choices.length > planningLimits.maximumChoices)
    throw new Error('Too many focus blocks in one proposal')
  const seen = new Set<string>()
  const tasks = new Map(state.tasks.filter((t) => t.status === 'todo').map((t) => [t.id, t]))
  for (const choice of decision.choices) {
    if (!tasks.has(choice.taskId) || seen.has(choice.taskId))
      throw new Error('Plan refers to an unknown, finished, or duplicate task')
    if (choice.minutes > state.profile.focusMinutes && tasks.get(choice.taskId)?.goalId !== null)
      throw new Error('A block exceeds the agreed focus duration')
    seen.add(choice.taskId)
  }
  const deferred = new Map(decision.deferred.map((d) => [d.taskId, d]))
  if (
    decision.deferred.some((d) => !tasks.has(d.taskId) || seen.has(d.taskId)) ||
    deferred.size !== decision.deferred.length
  )
    throw new Error('Deferrals must refer to distinct, unselected unfinished tasks')
  const free = availableIntervals(state, now).map((i) => ({ ...i }))
  const blocks: Plan['blocks'] = []
  let previousEnd: number | undefined
  const choices = decision.choices.flatMap((choice) => {
    if (tasks.get(choice.taskId)?.goalId !== null) return [choice]
    const cap = Math.min(
      state.profile.focusMinutes,
      currentCheckIn(state, now)?.energy === 'low'
        ? planningLimits.lowEnergyMinutes
        : planningLimits.maximumBlockMinutes,
    )
    const count = Math.ceil(choice.minutes / cap)
    // Evenly divide total effort, avoiding an unusable tiny final block.
    const duration = Math.floor(choice.minutes / count)
    if (duration < planningLimits.minimumBlockMinutes) return [{ ...choice, minutes: cap }]
    return Array.from({ length: count }, (_, index) => ({
      ...choice,
      minutes: duration + (index < choice.minutes % count ? 1 : 0),
    }))
  })
  for (const c of choices) {
    const task = tasks.get(c.taskId)!
    const requiredBreak = state.profile.breakMinutes * 60000
    const slot = free.find(
      (i) =>
        Math.max(i.start, previousEnd === undefined ? i.start : previousEnd + requiredBreak) +
          c.minutes * 60000 <=
        i.end,
    )
    if (!slot || blocks.length + (previousEnd === undefined ? 1 : 2) > 20) {
      deferred.set(c.taskId, {
        taskId: c.taskId,
        reason: blocks.some((block) => block.taskId === c.taskId)
          ? 'Only part of the estimated work fits. The remaining effort is outside this plan.'
          : 'This block does not fit before your cutoff and commitments.',
      })
      continue
    }
    const start = Math.max(
      slot.start,
      previousEnd === undefined ? slot.start : previousEnd + requiredBreak,
    )
    if (previousEnd !== undefined && slot.start <= previousEnd && start > previousEnd)
      blocks.push({
        id: randomUUID(),
        taskId: null,
        kind: 'break',
        title: 'Take a break',
        start: new Date(previousEnd).toISOString(),
        end: new Date(start).toISOString(),
        reason: 'Leave space to recover between focus blocks.',
      })
    blocks.push({
      id: randomUUID(),
      taskId: task.id,
      kind: 'focus',
      title: task.title,
      start: new Date(start).toISOString(),
      end: new Date(start + c.minutes * 60000).toISOString(),
      reason: c.reason,
    })
    slot.start = start + c.minutes * 60000
    previousEnd = slot.start
  }
  for (const task of tasks.values())
    if (!blocks.some((b) => b.taskId === task.id) && !deferred.has(task.id))
      deferred.set(task.id, {
        taskId: task.id,
        reason: 'Left outside this plan. Ask the mentor if you want to change the priorities.',
      })
  for (const task of tasks.values()) {
    if (task.goalId !== null || task.estimateMinutes === null) continue
    const reported =
      state.sessions
        .filter((session) => session.taskId === task.id && session.state === 'finished')
        .reduce((seconds, session) => seconds + session.elapsedSeconds, 0) / 60
    const remaining = Math.max(0, task.estimateMinutes - reported)
    const planned = blocks
      .filter((block) => block.taskId === task.id)
      .reduce(
        (minutes, block) => minutes + (Date.parse(block.end) - Date.parse(block.start)) / 60000,
        0,
      )
    if (planned > 0 && planned < remaining)
      deferred.set(task.id, {
        taskId: task.id,
        reason: `${Math.round(planned)} of about ${Math.round(remaining)} remaining minutes are scheduled. The rest still needs time.`,
      })
  }
  const partiallyScheduled = decision.choices.some(
    (choice) =>
      blocks
        .filter((block) => block.taskId === choice.taskId)
        .reduce(
          (minutes, block) => minutes + (Date.parse(block.end) - Date.parse(block.start)) / 60000,
          0,
        ) < choice.minutes,
  )
  const summary =
    decision.choices.length && !blocks.length
      ? 'None of the suggested blocks fits your remaining availability. Stop here or ask for a smaller next step.'
      : partiallyScheduled
        ? `Start with ${blocks.find((block) => block.kind === 'focus')?.title}. Other suggested work did not fit and is deferred below.`
        : decision.summary
  return {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    contextRevision: state.revision,
    inputRevision: state.planningRevision,
    status: 'proposed',
    summary,
    temporaryTasks: state.tasks.filter((task) => task.goalId === null),
    blocks,
    deferred: [...deferred.values()],
  }
}
