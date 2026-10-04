import { z } from 'zod'
import { Id, TaskSchema } from './state'
const text = z.string().trim().min(1).max(1500)
export const RoadmapTaskSchema = TaskSchema.pick({
  title: true,
  deadline: true,
  estimateMinutes: true,
})
  .extend({ id: Id.nullable() })
  .strict()
export const GoalDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('discuss'), explanation: text }).strict(),
  z
    .object({
      kind: z.literal('roadmap'),
      explanation: text,
      tasks: z.array(RoadmapTaskSchema).min(1).max(16),
      priority: z.number().int().min(1).max(5),
      preferredDailyMinutes: z.number().int().min(5).max(720).nullable(),
      deadline: z.string().date().nullable(),
    })
    .strict(),
])
export const GoalDiscussionInputSchema = z
  .object({ goalId: Id, text: z.string().trim().min(1).max(4000) })
  .strict()
export const RoadmapReviewSchema = z
  .object({
    decisionId: Id,
    tasks: z.array(RoadmapTaskSchema).min(1).max(16),
    priority: z.number().int().min(1).max(5),
    preferredDailyMinutes: z.number().int().min(5).max(720).nullable(),
    deadline: z.string().date().nullable(),
  })
  .strict()
export type RoadmapReview = z.infer<typeof RoadmapReviewSchema>
export type GoalDiscussionInput = z.infer<typeof GoalDiscussionInputSchema>
export interface GoalDiscussionResult {
  decisionId: string
  goalId: string
  decision: z.infer<typeof GoalDecisionSchema>
  inputRevision: number
}
