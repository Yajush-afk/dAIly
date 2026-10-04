import { z } from 'zod'
import { Time } from './state'
export const CollegeDaySchema = z
  .object({ weekday: z.number().int().min(0).max(6), start: Time, end: Time })
  .strict()
  .refine((day) => day.end > day.start, { message: 'College must end after it starts' })
export const ScheduleExtractionSchema = z
  .object({
    days: z.array(CollegeDaySchema).max(7),
    questions: z.array(z.string().trim().min(1).max(500)).max(7),
  })
  .strict()
  .refine((value) => new Set(value.days.map((day) => day.weekday)).size === value.days.length, {
    message: 'Use one college interval per weekday',
  })
export interface ScheduleImportResult {
  filename: string
  extraction: z.infer<typeof ScheduleExtractionSchema>
}
export const ScheduleReviewSchema = z
  .object({ days: z.array(CollegeDaySchema).max(7) })
  .strict()
  .refine((value) => new Set(value.days.map((day) => day.weekday)).size === value.days.length, {
    message: 'Use one college interval per weekday',
  })
export type ScheduleReview = z.infer<typeof ScheduleReviewSchema>
