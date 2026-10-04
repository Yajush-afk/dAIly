import { DateTime } from 'luxon'
import type { Profile, Snapshot } from '../shared/state'
import type { Store } from './store'

export function isQuiet(profile: Profile, now: number): boolean {
  const time = DateTime.fromMillis(now, { zone: profile.timezone }).toFormat('HH:mm')
  const start = profile.quietDuringSleep ? profile.bedtime : profile.quietStart
  const end = profile.quietDuringSleep ? profile.wakeTime : profile.quietEnd
  if (start === end) return false
  return start < end ? time >= start && time < end : time >= start || time < end
}
export function arrivalDue(
  state: Pick<Snapshot, 'profile' | 'timetable' | 'checkIns'>,
  now: number,
): string | undefined {
  const p = state.profile
  if (!p.notifications || !p.arrivalCheckIn || isQuiet(p, now)) return undefined
  const day = DateTime.fromMillis(now, { zone: p.timezone }),
    date = day.toISODate()!
  if (state.checkIns.some((c) => DateTime.fromISO(c.at).setZone(p.timezone).toISODate() === date))
    return undefined
  const overrides = state.timetable.filter((t) => t.date === date)
  const entries = (
    overrides.length
      ? overrides
      : state.timetable.filter((t) => !t.date && t.weekday === day.weekday % 7)
  ).filter((t) => !t.cancelled)
  const last = entries
    .map((t) => {
      const [hour, minute] = t.end.split(':').map(Number)
      return day
        .set({ hour, minute, second: 0, millisecond: 0 })
        .plus({ minutes: p.commuteMinutes })
        .toMillis()
    })
    .sort((a, b) => b - a)[0]
  if (last && now >= last && now < last + 10 * 60000) return `arrival:${date}`
  return undefined
}
export class LocalNotifications {
  constructor(
    private store: Store,
    private send: (title: string, body: string) => boolean,
  ) {}
  deliver(key: string, title: string, body: string, now = Date.now()): boolean {
    const p = this.store.profile()
    if (!p.notifications || isQuiet(p, now) || this.store.notificationSent(key)) return false
    if (!this.send(title, body)) return false
    this.store.recordNotification(key, now)
    return true
  }
}
