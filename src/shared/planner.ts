import { z } from 'zod'
import { Id } from './state'
import { planningLimits } from './planning-limits'

const reason = z.string().trim().min(1).max(1000)
export const DecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask_question'), question: reason }).strict(),
  z
    .object({
      kind: z.literal('propose_plan'),
      summary: reason,
      choices: z
        .array(
          z
            .object({
              taskId: Id,
              minutes: z
                .number()
                .int()
                .min(planningLimits.minimumBlockMinutes)
                .max(planningLimits.maximumBlockMinutes),
              reason,
            })
            .strict(),
        )
        .max(planningLimits.maximumChoices),
      deferred: z.array(z.object({ taskId: Id, reason }).strict()).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('propose_changes'),
      explanation: reason,
      tasks: z
        .array(
          z
            .object({
              goalId: Id,
              title: z.string().trim().min(1).max(500),
              estimateMinutes: z
                .number()
                .int()
                .min(planningLimits.minimumBlockMinutes)
                .max(planningLimits.maximumBlockMinutes),
            })
            .strict(),
        )
        .max(5),
      preferences: z
        .object({
          focusMinutes: z
            .number()
            .int()
            .min(planningLimits.minimumBlockMinutes)
            .max(planningLimits.maximumBlockMinutes)
            .optional(),
          breakMinutes: z.number().int().min(5).max(60).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ kind: z.literal('respond'), explanation: reason }).strict(),
])
export type Decision = z.infer<typeof DecisionSchema>
export const MentorInput = z
  .object({
    text: z.string().trim().min(1).max(4000),
    intent: z.enum(['plan', 'conversation']).default('plan'),
  })
  .strict()
export interface MentorResult {
  decision: Decision
  decisionId?: string
  planId?: string
  revision: number
  durationMs: number
  origin?: 'gemma' | 'availability'
}
