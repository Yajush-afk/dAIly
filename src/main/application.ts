import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { CheckInSchema, type Snapshot } from '../shared/state'
import { DecisionSchema } from '../shared/planner'
import {
  DayUpdateSchema,
  ReviewedChangesSchema,
  type DayUpdate,
  type ReviewedChanges,
  type WorkflowResult,
} from '../shared/workflow'
import type { SessionAction } from '../shared/session'
import type { Store } from './store'
import type { Planner } from './planner'
import type { Sessions } from './sessions'

export class DayApplication {
  constructor(
    private store: Store,
    private planner: Planner,
    private sessions: Sessions,
    private clock = Date.now,
    private changed: () => void = () => {},
  ) {}
  private async reconsider(text: string): Promise<WorkflowResult> {
    try {
      const result = await this.planner.request(text)
      return { state: this.store.view(), result }
    } catch (error) {
      return { state: this.store.view(), planningError: String(error) }
    } finally {
      this.changed()
    }
  }
  async checkInAndPlan(input: DayUpdate): Promise<WorkflowResult> {
    const update = DayUpdateSchema.parse(input),
      profile = this.store.profile()
    const now = DateTime.fromMillis(this.clock(), { zone: profile.timezone })
    const instant = (time: string): DateTime => {
      const [hour, minute] = time.split(':').map(Number)
      let at = now.set({ hour, minute, second: 0, millisecond: 0 })
      if (at < now && time < profile.wakeTime) at = at.plus({ days: 1 })
      return at
    }
    const busy = []
    if (update.busyStart || update.busyEnd) {
      if (!update.busyStart || !update.busyEnd)
        throw new Error('Enter both ends of your unavailable time.')
      const start = instant(update.busyStart),
        end = instant(update.busyEnd)
      if (end <= start) throw new Error('Unavailable time must end after it starts.')
      busy.push({
        start: start.toUTC().toISO()!,
        end: end.toUTC().toISO()!,
        title: 'Other commitment',
      })
    }
    this.store.put(
      'checkIns',
      CheckInSchema.parse({
        id: randomUUID(),
        at: now.toUTC().toISO(),
        availableUntil: instant(update.until).toUTC().toISO(),
        energy: update.energy,
        note: update.text,
        busy,
      }),
    )
    this.changed()
    return this.reconsider(
      update.text || 'Help me choose an achievable plan with the time and energy I reported.',
    )
  }
  async recordOutcome(
    command: Extract<SessionAction, { action: 'outcome' }>,
  ): Promise<WorkflowResult> {
    const before = this.store.get('sessions', command.id)
    this.sessions.act(command)
    this.changed()
    if (before?.state === 'finished') return { state: this.store.view() }
    return this.reconsider(
      'I saved my actual session outcome. Reconsider the remaining day using that outcome, and ask about an obstacle if the same task keeps being deferred.',
    )
  }
  approveChanges(input: ReviewedChanges): Snapshot {
    const review = ReviewedChangesSchema.parse(input)
    if (this.store.proposalApplied(review.decisionId)) return this.store.view()
    const message = this.store.get('messages', review.decisionId)
    if (message?.role !== 'mentor' || message.details?.type !== 'decision')
      throw new Error('This suggestion is no longer available.')
    const saved = z
      .object({ decision: DecisionSchema, inputRevision: z.number().int() })
      .parse(JSON.parse(message.details.payload))
    if (saved.inputRevision !== this.store.planningRevision)
      throw new Error('Your planning inputs changed. Ask for a fresh suggestion.')
    if (saved.decision.kind !== 'propose_changes')
      throw new Error('This is not a changes proposal.')
    const preferences = saved.decision.preferences
    const config = this.store.config()
    const result = this.store.transaction(() => {
      this.store.saveConfig({
        ...config,
        profile: { ...config.profile, ...preferences },
        tasks: [
          ...config.tasks,
          ...review.tasks.map((t) => ({
            ...t,
            id: randomUUID(),
            status: 'todo' as const,
            deadline: null,
          })),
        ],
      })
      this.store.recordApproval(review.decisionId, this.clock())
      this.store.put('messages', {
        id: randomUUID(),
        at: new Date(this.clock()).toISOString(),
        role: 'user',
        text: 'Saved the reviewed task and preference changes.',
        details: {
          type: 'changes-accept',
          payload: JSON.stringify({ decisionId: review.decisionId }),
        },
      })
      return this.store.view()
    })
    this.changed()
    return result
  }
}
