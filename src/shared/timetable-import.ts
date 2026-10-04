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
export type ScheduleExtraction = z.infer<typeof ScheduleExtractionSchema>
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

const ModelExtractionSchema = z.object({
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start: z.unknown(),
        end: z.unknown(),
      }),
    )
    .max(21),
  questions: z.array(z.string()).optional(),
})

function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const input = value.trim().replace(/\./g, '').toUpperCase()
  const twentyFourHour = input.match(/^(\d{1,2}):([0-5]\d)$/)
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1])
    if (hour > 23) return undefined
    return `${String(hour).padStart(2, '0')}:${twentyFourHour[2]}`
  }
  const twelveHour = input.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/)
  if (!twelveHour) return undefined
  const hour = Number(twelveHour[1])
  if (hour < 1 || hour > 12) return undefined
  const minute = twelveHour[2] || '00'
  const normalizedHour = (hour % 12) + (twelveHour[3] === 'PM' ? 12 : 0)
  return `${String(normalizedHour).padStart(2, '0')}:${minute}`
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Converts common model time formats into the strict times used by the app.
 * Ambiguous or inconsistent days are left out and returned as review questions. */
export function parseScheduleExtraction(answer: string): ScheduleExtraction {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return {
      days: [],
      questions: [
        'I could not read clear weekday times. Try a clearer file or enter the times manually.',
      ],
    }
  }

  const modelOutput = ModelExtractionSchema.safeParse(parsed)
  if (!modelOutput.success) {
    return {
      days: [],
      questions: [
        'I could not read clear weekday times. Try a clearer file or enter the times manually.',
      ],
    }
  }

  const questions: string[] = []
  const modelQuestions =
    modelOutput.data.questions?.map((question) => question.trim()).filter(Boolean) ?? []
  const days: z.infer<typeof CollegeDaySchema>[] = []
  const byWeekday = new Map<number, typeof modelOutput.data.days>()
  for (const day of modelOutput.data.days) {
    byWeekday.set(day.weekday, [...(byWeekday.get(day.weekday) ?? []), day])
  }

  for (const [weekday, candidates] of byWeekday) {
    if (candidates.length !== 1) {
      questions.push(
        `I found more than one possible interval for ${weekdayNames[weekday]}. Please confirm its college hours.`,
      )
      continue
    }
    const candidate = candidates[0]
    const start = normalizeTime(candidate.start)
    const end = normalizeTime(candidate.end)
    if (!start || !end || end <= start) {
      questions.push(
        `I could not confirm both college times for ${weekdayNames[weekday]}. Please enter or check them.`,
      )
      continue
    }
    days.push({ weekday, start, end })
  }

  return ScheduleExtractionSchema.parse({
    days,
    questions: [...new Set([...questions, ...modelQuestions])]
      .slice(0, 7)
      .map((question) => question.slice(0, 500)),
  })
}
