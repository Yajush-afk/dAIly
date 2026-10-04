import { z } from 'zod'
import type { Snapshot } from './state'
export const HistoryQuerySchema = z
  .object({
    kind: z.enum(['sessions', 'plans']),
    from: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    before: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((value) => !value.from || !value.until || value.from < value.until, {
    message: 'The range must end after it starts.',
  })
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>
export interface HistoryPage {
  kind: HistoryQuery['kind']
  sessions: Snapshot['sessions']
  plans: Snapshot['plans']
  next: number | null
  totals: {
    sessions: number
    seconds: number
    byDay: { date: string; sessions: number; seconds: number }[]
    byGoal: { goalId: string | null; sessions: number; seconds: number }[]
  }
}

export interface DashboardSummary {
  date: string
  yesterday: {
    date: string
    sessions: number
    seconds: number
    recentWork: Snapshot['sessions']
  }
  pendingOutcomes: number
}
