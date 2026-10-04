import { z } from 'zod'

export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const Id = z.string().uuid()
export const IsoDate = z.string().datetime()
const text = z.string().trim().min(1).max(500)
export const ProfileSchema = z
  .object({
    name: text,
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    }),
    commuteMinutes: z.number().int().min(0).max(240),
    bedtime: Time,
    wakeTime: Time,
    focusMinutes: z.number().int().min(5).max(120),
    breakMinutes: z.number().int().min(5).max(60),
    quietStart: Time,
    quietEnd: Time,
    notifications: z.boolean(),
    arrivalCheckIn: z.boolean(),
    launchAtLogin: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
    onboardingComplete: z.boolean(),
  })
  .strict()
export type Profile = z.infer<typeof ProfileSchema>
export const defaultProfile: Profile = {
  name: 'Kushagra',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  commuteMinutes: 30,
  bedtime: '23:30',
  wakeTime: '07:00',
  focusMinutes: 45,
  breakMinutes: 10,
  quietStart: '23:30',
  quietEnd: '07:00',
  notifications: false,
  arrivalCheckIn: false,
  launchAtLogin: false,
  theme: 'system',
  onboardingComplete: false,
}
export const GoalSchema = z
  .object({
    id: Id,
    title: text,
    priority: z.number().int().min(1).max(5),
    deadline: z.string().date().nullable(),
  })
  .strict()
export const TaskSchema = z
  .object({
    id: Id,
    goalId: Id,
    title: text,
    estimateMinutes: z.number().int().min(5).max(480),
    deadline: z.string().date().nullable(),
    status: z.enum(['todo', 'done']),
  })
  .strict()
export const TimetableSchema = z
  .object({
    id: Id,
    weekday: z.number().int().min(0).max(6),
    date: z.string().date().nullable(),
    title: text,
    start: Time,
    end: Time,
    cancelled: z.boolean(),
  })
  .strict()
  .refine((value) => value.cancelled || value.end > value.start, {
    message: 'Class end must be after its start',
  })
export const CheckInSchema = z
  .object({
    id: Id,
    at: IsoDate,
    availableUntil: IsoDate.nullable(),
    energy: z.enum(['low', 'okay', 'high', 'unknown']),
    note: z.string().trim().max(4000),
    busy: z
      .array(
        z
          .object({ start: IsoDate, end: IsoDate, title: text })
          .strict()
          .refine((b) => b.end > b.start, { message: 'Unavailable time must end after it starts' }),
      )
      .max(20),
  })
  .strict()
export const BlockSchema = z
  .object({
    id: Id,
    taskId: Id.nullable(),
    kind: z.enum(['focus', 'break']),
    title: text,
    start: IsoDate,
    end: IsoDate,
    reason: z.string().max(1000),
  })
  .strict()
export const PlanSchema = z
  .object({
    id: Id,
    createdAt: IsoDate,
    contextRevision: z.number().int().nonnegative(),
    inputRevision: z.number().int().nonnegative().optional(),
    status: z.enum(['proposed', 'accepted', 'superseded']),
    summary: z.string().max(2000),
    blocks: z.array(BlockSchema).max(20),
    deferred: z.array(z.object({ taskId: Id, reason: z.string().max(1000) }).strict()).max(100),
  })
  .strict()
export const SessionSchema = z
  .object({
    id: Id,
    taskId: Id,
    blockId: Id.nullable(),
    startedAt: IsoDate,
    segmentStartedAt: IsoDate.nullable(),
    targetMinutes: z.number().int().min(1).max(120),
    elapsedSeconds: z.number().nonnegative(),
    state: z.enum(['running', 'paused', 'awaiting-outcome', 'finished']),
    outcome: z.enum(['completed', 'partial', 'interrupted', 'abandoned']).nullable(),
    work: z.string().max(4000),
    interruption: z.string().max(2000),
    finishedAt: IsoDate.nullable(),
    needsReconciliation: z.boolean(),
  })
  .strict()
export const MessageSchema = z
  .object({
    id: Id,
    at: IsoDate,
    role: z.enum(['user', 'mentor']),
    text: z.string().max(12000),
    details: z
      .object({
        type: z.enum(['decision', 'session-action', 'plan-accept', 'changes-accept']),
        payload: z.string().max(20000),
      })
      .strict()
      .optional(),
  })
  .strict()
export type Goal = z.infer<typeof GoalSchema>
export type Task = z.infer<typeof TaskSchema>
export type TimetableEntry = z.infer<typeof TimetableSchema>
export type CheckIn = z.infer<typeof CheckInSchema>
export type Plan = z.infer<typeof PlanSchema>
export type Block = z.infer<typeof BlockSchema>
export type FocusSession = z.infer<typeof SessionSchema>
export type Message = z.infer<typeof MessageSchema>
export interface Snapshot {
  revision: number
  planningRevision?: number
  recurringDeferrals?: { taskId: string; deferredDays: number }[]
  profile: Profile
  goals: Goal[]
  tasks: Task[]
  timetable: TimetableEntry[]
  checkIns: CheckIn[]
  plans: Plan[]
  sessions: FocusSession[]
  messages: Message[]
}
export const ConfigSchema = z
  .object({
    profile: ProfileSchema,
    goals: z.array(GoalSchema).max(100),
    tasks: z.array(TaskSchema).max(500),
    timetable: z.array(TimetableSchema).max(100),
  })
  .strict()
export type Config = z.infer<typeof ConfigSchema>
export const schemas = {
  goals: GoalSchema,
  tasks: TaskSchema,
  timetable: TimetableSchema,
  checkIns: CheckInSchema,
  plans: PlanSchema,
  sessions: SessionSchema,
  messages: MessageSchema,
}
export type RecordKind = keyof typeof schemas
