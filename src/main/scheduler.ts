import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import type { Decision } from '../shared/planner'
import type { CheckIn, Plan, Snapshot } from '../shared/state'

export interface Interval { start: number; end: number }
export function currentCheckIn(state: Snapshot, now: number): CheckIn | undefined {
  const p = state.profile, [hour, minute] = p.wakeTime.split(':').map(Number)
  const planningDay = (at: number): string | null => DateTime.fromMillis(at, { zone: p.timezone }).minus({ minutes: hour * 60 + minute }).toISODate()
  return [...state.checkIns].sort((a, b) => b.at.localeCompare(a.at)).find(c => Date.parse(c.at) <= now && now - Date.parse(c.at) < 18 * 3600000 && planningDay(Date.parse(c.at)) === planningDay(now))
}
export function availableIntervals(state: Snapshot, now: number): Interval[] {
  const p = state.profile
  const local = DateTime.fromMillis(now, { zone: p.timezone })
  const at = (day: DateTime, time: string): DateTime => { const [hour, minute] = time.split(':').map(Number); return day.set({ hour, minute, second: 0, millisecond: 0 }) }
  const bedtimeToday = at(local, p.bedtime)
  const wake = at(local, p.wakeTime)
  // A late bedtime belongs to the evening that started before midnight.
  const cutoff = p.bedtime < p.wakeTime && local >= wake ? bedtimeToday.plus({ days: 1 }) : bedtimeToday
  const fresh = currentCheckIn(state, now)
  const end = Math.min(cutoff.toMillis(), fresh?.availableUntil ? Date.parse(fresh.availableUntil) : cutoff.toMillis())
  if (end <= now) return []
  const busy: Interval[] = (fresh?.busy || []).map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
  for (let day = local.startOf('day'); day.toMillis() < end; day = day.plus({ days: 1 })) {
    const overrides = state.timetable.filter(t => t.date === day.toISODate())
    const entries = overrides.length ? overrides : state.timetable.filter(t => !t.date && t.weekday === day.weekday % 7)
    for (const t of entries.filter(t => !t.cancelled)) busy.push({ start: at(day, t.start).minus({ minutes: p.commuteMinutes }).toMillis(), end: at(day, t.end).plus({ minutes: p.commuteMinutes }).toMillis() })
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

export function schedule(state: Snapshot, decision: Extract<Decision, { kind: 'propose_plan' }>, now: number): Plan {
  const seen = new Set<string>()
  const tasks = new Map(state.tasks.filter(t => t.status === 'todo').map(t => [t.id, t]))
  for (const choice of decision.choices) {
    if (!tasks.has(choice.taskId) || seen.has(choice.taskId)) throw new Error('Plan refers to an unknown, finished, or duplicate task')
    if (choice.minutes > state.profile.focusMinutes) throw new Error('A block exceeds the agreed focus duration')
    seen.add(choice.taskId)
  }
  const deferred = new Map(decision.deferred.map(d => [d.taskId, d]))
  if (decision.deferred.some(d => !tasks.has(d.taskId) || seen.has(d.taskId)) || deferred.size !== decision.deferred.length) throw new Error('Deferrals must refer to distinct, unselected unfinished tasks')
  const free = availableIntervals(state, now).map(i => ({ ...i }))
  const blocks: Plan['blocks'] = []
  let previousEnd: number | undefined
  for (const c of decision.choices) {
    const task = tasks.get(c.taskId)!
    const requiredBreak = state.profile.breakMinutes * 60000
    const slot = free.find(i => Math.max(i.start, previousEnd === undefined ? i.start : previousEnd + requiredBreak) + c.minutes * 60000 <= i.end)
    if (!slot) { deferred.set(c.taskId, { taskId: c.taskId, reason: 'This block does not fit before your cutoff and commitments.' }); continue }
    const start = Math.max(slot.start, previousEnd === undefined ? slot.start : previousEnd + requiredBreak)
    if (previousEnd !== undefined && slot.start <= previousEnd && start > previousEnd) blocks.push({ id: randomUUID(), taskId: null, kind: 'break', title: 'Take a break', start: new Date(previousEnd).toISOString(), end: new Date(start).toISOString(), reason: 'Leave space to recover between focus blocks.' })
    blocks.push({ id: randomUUID(), taskId: task.id, kind: 'focus', title: task.title, start: new Date(start).toISOString(), end: new Date(start + c.minutes * 60000).toISOString(), reason: c.reason })
    slot.start = start + c.minutes * 60000; previousEnd = slot.start
  }
  for (const task of tasks.values()) if (!blocks.some(b => b.taskId === task.id) && !deferred.has(task.id)) deferred.set(task.id, { taskId: task.id, reason: 'Left outside this plan. Ask the mentor if you want to change the priorities.' })
  const summary = decision.choices.length && !blocks.length ? 'None of the suggested blocks fits your remaining availability. Stop here or ask for a smaller next step.' : decision.choices.some(c => !blocks.some(b => b.taskId === c.taskId)) ? `${decision.summary} Some suggested work did not fit and is deferred below.` : decision.summary
  return { id: randomUUID(), createdAt: new Date(now).toISOString(), contextRevision: state.revision, status: 'proposed', summary, blocks, deferred: [...deferred.values()] }
}
