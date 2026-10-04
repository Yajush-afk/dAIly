import { z } from 'zod'
import { Id } from './state'
export const TemporaryTaskDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    estimateMinutes: z.number().int().min(5).max(720).nullable(),
    deadline: z.string().date().nullable(),
    sourceQuote: z.string().trim().min(1).max(4000),
  })
  .strict()
export const TemporaryTaskExtractionSchema = z
  .object({
    tasks: z.array(TemporaryTaskDraftSchema).max(5),
  })
  .strict()
export const TemporaryTaskDecisionSchema = z
  .object({
    kind: z.literal('propose_temporary_tasks'),
    explanation: z.string().trim().min(1).max(1000),
    tasks: z.array(TemporaryTaskDraftSchema).min(1).max(5),
    until: z.string().datetime(),
  })
  .strict()
export const TemporaryTaskReviewSchema = z
  .object({
    decisionId: Id,
    action: z.enum(['accept', 'dismiss']),
    tasks: z
      .array(TemporaryTaskDraftSchema.extend({ estimateMinutes: z.number().int().min(5).max(720) }))
      .max(5),
  })
  .strict()
  .refine((value) => value.action !== 'accept' || value.tasks.length > 0, {
    message: 'Confirm at least one task, or skip this suggestion.',
  })
export type TemporaryTaskDraft = z.infer<typeof TemporaryTaskDraftSchema>
export type TemporaryTaskReview = z.infer<typeof TemporaryTaskReviewSchema>
