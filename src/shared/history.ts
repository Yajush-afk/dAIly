import { z } from 'zod'
import type { Snapshot } from './state'
export const HistoryQuerySchema = z
  .object({
    kind: z.enum(['sessions', 'plans']),
    before: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>
export interface HistoryPage {
  kind: HistoryQuery['kind']
  sessions: Snapshot['sessions']
  plans: Snapshot['plans']
  next: number | null
  totals: {
    sessions: number
    seconds: number
    byGoal: { goalId: string; sessions: number; seconds: number }[]
  }
}
