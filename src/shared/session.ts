import { z } from 'zod'
import { Id } from './state'
export const SessionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), blockId: Id }).strict(),
  z.object({ action: z.enum(['pause', 'resume', 'finish', 'stop']), id: Id }).strict(),
  z
    .object({
      action: z.literal('reconcile'),
      id: Id,
      elapsedSeconds: z.number().int().min(0).max(86400),
    })
    .strict(),
  z
    .object({
      action: z.literal('outcome'),
      id: Id,
      outcome: z.enum(['completed', 'partial', 'interrupted', 'abandoned']),
      elapsedSeconds: z.number().int().min(0).max(86400),
      work: z.string().trim().max(4000),
      interruption: z.string().trim().max(2000),
    })
    .strict(),
])
export type SessionAction = z.infer<typeof SessionActionSchema>
