import { z } from 'zod'
import { Id, Time, TaskFieldsSchema, type Snapshot } from './state'
import type { MentorResult } from './planner'
export const DayUpdateSchema = z
  .object({
    text: z.string().trim().max(4000),
    energy: z.enum(['unknown', 'low', 'okay', 'high']),
    until: Time,
    busyStart: z.union([Time, z.literal('')]),
    busyEnd: z.union([Time, z.literal('')]),
  })
  .strict()
export type DayUpdate = z.infer<typeof DayUpdateSchema>
export const ReviewedChangesSchema = z
  .object({
    decisionId: Id,
    tasks: z
      .array(
        TaskFieldsSchema.pick({ goalId: true, title: true, estimateMinutes: true }).extend({
          goalId: Id,
        }),
      )
      .max(5),
  })
  .strict()
export type ReviewedChanges = z.infer<typeof ReviewedChangesSchema>
export interface WorkflowResult {
  state: Snapshot
  result?: MentorResult
  planningError?: string
}
