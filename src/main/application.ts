import { TemporaryTaskDecisionSchema, TemporaryTaskReviewSchema } from '../shared/temporary-tasks'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { CheckInSchema, type Snapshot } from '../shared/state'
import { DecisionSchema } from '../shared/planner'
import {
  DayUpdateSchema,
  ReviewedChangesSchema,
  type DayUpdate,
  type ReviewedChanges,
  type WorkflowResult,
} from '../shared/workflow'
import type { SessionAction } from '../shared/session'
import type { Store } from './store'
import type { Planner } from './planner'
import type { Sessions } from './sessions'
import {
  GoalDecisionSchema,
  goalDecisionFormat,
  GoalDiscussionInputSchema,
  type GoalDiscussionInput,
  RoadmapReviewSchema,
  type RoadmapReview,
  type GoalDiscussionResult,
} from '../shared/goal-mentor'
import { z } from 'zod'
import { GoalSchema, TaskSchema } from '../shared/state'
import {
  parseScheduleExtraction,
  ScheduleReviewSchema,
  type ScheduleImportResult,
  type ScheduleReview,
} from '../shared/timetable-import'
import ExcelJS from 'exceljs'
import { extname, basename } from 'node:path'

export class DayApplication {
  constructor(
    private store: Store,
    private planner: Planner,
    private sessions: Sessions,
    private clock = Date.now,
    private changed: () => void = () => {},
  ) {}
  private async reconsider(text: string, discover = false): Promise<WorkflowResult> {
    try {
      const result = await this.planner.request(text, 'plan', [], discover)
      return { state: this.store.view(), result }
    } catch (error) {
      return { state: this.store.view(), planningError: String(error) }
    } finally {
      this.changed()
    }
  }
  async checkInAndPlan(input: DayUpdate): Promise<WorkflowResult> {
    const update = DayUpdateSchema.parse(input),
      profile = this.store.profile()
    const now = DateTime.fromMillis(this.clock(), { zone: profile.timezone })
    const holiday = explicitCollegeHoliday(update.text, now)
    const instant = (time: string): DateTime => {
      const [hour, minute] = time.split(':').map(Number)
      let at = now.set({ hour, minute, second: 0, millisecond: 0 })
      if (at < now && time < profile.wakeTime) at = at.plus({ days: 1 })
      return at
    }
    const busy = []
    if (update.busyStart || update.busyEnd) {
      if (!update.busyStart || !update.busyEnd)
        throw new Error('Enter both ends of your unavailable time.')
      const start = instant(update.busyStart),
        end = instant(update.busyEnd)
      if (end <= start) throw new Error('Unavailable time must end after it starts.')
      busy.push({
        start: start.toUTC().toISO()!,
        end: end.toUTC().toISO()!,
        title: 'Other commitment',
      })
    }
    this.store.put(
      'checkIns',
      CheckInSchema.parse({
        id: randomUUID(),
        at: now.toUTC().toISO(),
        availableUntil: instant(update.until).toUTC().toISO(),
        energy: update.energy,
        note: update.text,
        busy,
      }),
    )
    if (holiday) {
      const config = this.store.config()
      const weekly = config.timetable.filter(
        (item) => !item.date && item.weekday === holiday.weekday,
      )
      const cancelled = {
        id: randomUUID(),
        weekday: holiday.weekday,
        date: holiday.date,
        title: 'College',
        start: weekly[0]?.start || '00:00',
        end: weekly[0]?.end || '00:00',
        cancelled: true,
      }
      this.store.saveConfig({
        ...config,
        timetable: [...config.timetable.filter((item) => item.date !== holiday.date), cancelled],
      })
      this.store.put('messages', {
        id: randomUUID(),
        at: now.toUTC().toISO()!,
        role: 'mentor',
        text:
          'Marked ' +
          DateTime.fromISO(holiday.date).toFormat('cccc, LLL d') +
          ' as a college holiday from your update.',
        channel: 'day',
      })
    }
    this.changed()
    return this.reconsider(
      update.text || 'Help me choose an achievable plan with the time and energy I reported.',
      true,
    )
  }
  async reviewTemporaryTasks(input: unknown): Promise<WorkflowResult> {
    const review = TemporaryTaskReviewSchema.parse(input)
    if (this.store.proposalApplied(review.decisionId))
      return { state: this.store.view(this.clock()) }
    const message = this.store.get('messages', review.decisionId)
    if (message?.role !== 'mentor' || message.details?.type !== 'decision')
      throw new Error('This suggestion is no longer available.')
    const saved = z
      .object({ decision: TemporaryTaskDecisionSchema, inputRevision: z.number().int() })
      .parse(JSON.parse(message.details.payload))
    if (
      saved.inputRevision !== this.store.planningRevision ||
      Date.parse(saved.decision.until) <= this.clock()
    )
      throw new Error('Your day changed. Ask for a fresh plan before adding this work.')
    if (
      review.tasks.some(
        (task) =>
          !saved.decision.tasks.some((original) => original.sourceQuote === task.sourceQuote),
      )
    )
      throw new Error('Review only tasks from this suggestion.')
    const normalize = (title: string) => title.toLocaleLowerCase().trim()
    if (new Set(review.tasks.map((task) => normalize(task.title))).size !== review.tasks.length)
      throw new Error('Each temporary task must have a distinct title.')
    this.store.transaction(() => {
      if (review.action === 'accept') {
        this.store.invalidatePlanningInputs()
        const tasks = review.tasks.map((task) => ({
          id: randomUUID(),
          goalId: null,
          temporaryUntil: saved.decision.until,
          title: task.title,
          estimateMinutes: task.estimateMinutes,
          deadline: task.deadline,
          status: 'todo' as const,
        }))
        const carried = this.store.activeTemporaryTasks(this.clock())
        if (carried.length + tasks.length > 8)
          throw new Error(
            'There are too many temporary tasks in this day. Clear the plan before adding more.',
          )
        this.store.put('plans', {
          id: randomUUID(),
          createdAt: new Date(this.clock()).toISOString(),
          contextRevision: this.store.revision,
          inputRevision: this.store.planningRevision,
          status: 'proposed',
          summary: 'Temporary work confirmed. Review the revised schedule before applying it.',
          blocks: [],
          deferred: [],
          temporaryTasks: [...carried, ...tasks],
        })
      }
      this.store.recordApproval(review.decisionId, this.clock())
      this.store.put('messages', {
        id: randomUUID(),
        at: new Date(this.clock()).toISOString(),
        role: 'user',
        channel: 'day',
        text:
          review.action === 'accept'
            ? 'Confirmed this temporary work for the plan.'
            : 'Skipped adding this temporary work.',
        details: {
          type: 'changes-accept',
          payload: JSON.stringify({ decisionId: review.decisionId }),
        },
      })
    })
    this.changed()
    return this.reconsider(
      review.action === 'accept'
        ? 'I confirmed temporary work for this plan. Prioritize its deadline, account for its estimated total effort and breaks, then fit remaining goal work honestly. Propose the full schedule for my review.'
        : 'I chose not to add that work. Plan using only existing tasks.',
    )
  }
  clearPlan(): Snapshot {
    if (this.sessions.active())
      throw new Error(
        'Finish or stop the active focus session and save its outcome before clearing the plan.',
      )
    this.store.transaction(() => {
      for (const plan of this.store.openPlans())
        this.store.put('plans', { ...plan, status: 'superseded' })
      this.store.invalidatePlanningInputs()
    })
    this.changed()
    return this.store.view(this.clock())
  }
  async recordOutcome(
    command: Extract<SessionAction, { action: 'outcome' }>,
  ): Promise<WorkflowResult> {
    const before = this.store.get('sessions', command.id)
    this.sessions.act(command)
    this.changed()
    if (before?.state === 'finished') return { state: this.store.view() }
    return this.reconsider(
      'I saved my actual session outcome. Reconsider the remaining day using that outcome, and ask about an obstacle if the same task keeps being deferred.',
    )
  }
  approveChanges(input: ReviewedChanges): Snapshot {
    const review = ReviewedChangesSchema.parse(input)
    if (this.store.proposalApplied(review.decisionId)) return this.store.view()
    const message = this.store.get('messages', review.decisionId)
    if (message?.role !== 'mentor' || message.details?.type !== 'decision')
      throw new Error('This suggestion is no longer available.')
    const saved = z
      .object({ decision: DecisionSchema, inputRevision: z.number().int() })
      .parse(JSON.parse(message.details.payload))
    if (saved.inputRevision !== this.store.planningRevision)
      throw new Error('Your planning inputs changed. Ask for a fresh suggestion.')
    if (saved.decision.kind !== 'propose_changes')
      throw new Error('This is not a changes proposal.')
    const preferences = saved.decision.preferences
    const config = this.store.config()
    const result = this.store.transaction(() => {
      this.store.saveConfig({
        ...config,
        profile: { ...config.profile, ...preferences },
        tasks: [
          ...config.tasks,
          ...review.tasks.map((t) => ({
            ...t,
            id: randomUUID(),
            status: 'todo' as const,
            deadline: null,
          })),
        ],
      })
      this.store.recordApproval(review.decisionId, this.clock())
      this.store.put('messages', {
        id: randomUUID(),
        at: new Date(this.clock()).toISOString(),
        role: 'user',
        text: 'Saved the reviewed task and preference changes.',
        details: {
          type: 'changes-accept',
          payload: JSON.stringify({ decisionId: review.decisionId }),
        },
      })
      return this.store.view()
    })
    this.changed()
    return result
  }
  async discussGoal(input: unknown): Promise<GoalDiscussionResult> {
    const { goalId, text } = GoalDiscussionInputSchema.parse(input)
    const state = this.store.planningState(this.clock())
    const goal = state.goals.find((item) => item.id === goalId)
    if (!goal) throw new Error('This goal was removed. Refresh Goals and choose another one.')
    const tasks = state.tasks
      .filter((task) => task.goalId === goalId)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    const recent = state.sessions
      .filter((session) => tasks.some((task) => task.id === session.taskId))
      .slice(-12)
      .map(({ taskId, outcome, targetMinutes, elapsedSeconds, work, interruption, startedAt }) => ({
        taskId,
        outcome,
        targetMinutes,
        elapsedSeconds,
        work,
        interruption,
        startedAt,
      }))
    const conversation = this.store.goalConversation(goalId, 6).map((message) => ({
      role: message.role === 'mentor' ? ('assistant' as const) : ('user' as const),
      content: message.text.slice(0, 600),
    }))
    const now = DateTime.fromMillis(this.clock(), { zone: state.profile.timezone }).toISODate()
    const inputRevision = this.store.planningRevision
    this.store.put('messages', {
      id: randomUUID(),
      at: new Date(this.clock()).toISOString(),
      role: 'user',
      text,
      channel: 'goal',
      goalId,
    })
    try {
      const instructions = `You are dAIly's practical goal mentor. Have a focused conversation about the selected goal. Ask a clear question when the goal, available effort, scope, or deadline is unclear. Only propose a roadmap after the user has discussed enough detail or asks you to draft one. Do not invent facts or claim that a suggestion has been saved. A roadmap must contain the complete ordered set of unfinished tasks with realistic deadlines and estimates for the total effort of each whole task, not daily effort. Include every unfinished task exactly once using its supplied ID. Use null only for new tasks. Leave completed tasks out of the roadmap; the application preserves them automatically. Put new tasks first in dependency order then by deadline. Keep the chosen goal's main deadline, priority, and preferred daily minutes distinct. When the user asks you to recommend an order, use your judgment to suggest one and explain it. Do not ask them to choose percentages or repeat questions already answered. Ask only about missing facts that would materially change the roadmap. Keep explanations to at most three sentences. Return compact JSON without indentation. Use ordinary punctuation and avoid em dashes. Today is ${now}. Return structured data.`
      const request: GoalDiscussionInput = { goalId, text }
      const messages: import('../shared/ai').ChatMessage[] = [
        { role: 'system', content: instructions },
        ...conversation,
        {
          role: 'user',
          content: JSON.stringify({ goal, tasks, recentOutcomes: recent, currentRequest: text }),
        },
      ]
      const readDecision = (answer: string) => {
        const decision = GoalDecisionSchema.parse(JSON.parse(answer))
        if (decision.kind === 'roadmap') {
          if (
            decision.tasks.some(
              (task) =>
                task.id !== null &&
                !tasks.some((old) => old.id === task.id && old.status === 'todo'),
            )
          )
            throw new Error('The proposed roadmap included an unknown or completed task.')
          const ids = decision.tasks.filter((task) => task.id).map((task) => task.id)
          if (new Set(ids).size !== ids.length)
            throw new Error('The proposed roadmap repeated a task.')
          if (tasks.some((task) => task.status === 'todo' && !ids.includes(task.id)))
            throw new Error(
              'Include every unfinished task by its supplied ID. Do not omit a topic from the roadmap.',
            )
          const completed = tasks.filter((task) => task.status === 'done')
          if (completed.some((task) => decision.tasks.some((next) => next.id === task.id)))
            throw new Error('Completed work cannot be replanned.')
        }
        return decision
      }
      const answer = await this.planner.discussGoal(
        request,
        state,
        messages,
        goalDecisionFormat(tasks.filter((task) => task.status === 'todo').map((task) => task.id)),
        (content) => {
          readDecision(content)
        },
      )
      if (this.store.planningRevision !== inputRevision)
        throw new Error(
          'This goal changed while dAIly was considering it. Please send your message again.',
        )
      const decision = readDecision(answer)
      const decisionId = randomUUID()
      const display = decision.explanation
      this.store.put('messages', {
        id: decisionId,
        at: new Date(this.clock()).toISOString(),
        role: 'mentor',
        text: display,
        channel: 'goal',
        goalId,
        details: { type: 'goal-decision', payload: JSON.stringify({ decision, inputRevision }) },
      })
      return { decisionId, goalId, decision, inputRevision }
    } finally {
      this.changed()
    }
  }
  approveRoadmap(input: unknown): Snapshot {
    const review: RoadmapReview = RoadmapReviewSchema.parse(input)
    const savedMessage = this.store.get('messages', review.decisionId)
    if (savedMessage?.role !== 'mentor' || savedMessage.details?.type !== 'goal-decision')
      throw new Error('This roadmap proposal is no longer available.')
    const saved = z
      .object({ decision: GoalDecisionSchema, inputRevision: z.number().int() })
      .parse(JSON.parse(savedMessage.details.payload))
    if (saved.inputRevision !== this.store.planningRevision)
      throw new Error('Your goals changed. Ask dAIly to reconsider this roadmap before saving it.')
    if (saved.decision.kind !== 'roadmap')
      throw new Error('This message does not contain a roadmap proposal.')
    const config = this.store.config(),
      goal = config.goals.find((item) => item.id === savedMessage.goalId)
    if (!goal) throw new Error('This goal has been removed.')
    const current = config.tasks.filter((task) => task.goalId === goal.id)
    const ids = new Set(review.tasks.flatMap((task) => (task.id ? [task.id] : [])))
    if (
      review.tasks.some(
        (task) =>
          task.id !== null && !current.some((old) => old.id === task.id && old.status === 'todo'),
      ) ||
      ids.size !== review.tasks.filter((task) => task.id !== null).length
    )
      throw new Error('Use each unfinished task once. Completed work is preserved automatically.')
    if (current.some((task) => this.store.activeSession()?.taskId === task.id && !ids.has(task.id)))
      throw new Error('The roadmap must preserve the active focus session.')
    const ordered = [...review.tasks].sort((a, b) =>
      (a.deadline || '9999').localeCompare(b.deadline || '9999'),
    )
    const completed = current.filter((task) => task.status === 'done')
    const tasks = [
      ...config.tasks.filter((task) => task.goalId !== goal.id),
      ...completed,
      ...ordered.map((task) =>
        TaskSchema.parse({
          id: task.id || randomUUID(),
          goalId: goal.id,
          title: task.title,
          deadline: task.deadline,
          estimateMinutes: task.estimateMinutes,
          status: 'todo',
        }),
      ),
    ]
    const goals = config.goals.map((item) =>
      item.id === goal.id
        ? GoalSchema.parse({
            ...item,
            priority: review.priority,
            deadline: review.deadline,
            preferredDailyMinutes: review.preferredDailyMinutes,
          })
        : item,
    )
    this.store.saveConfig({ ...config, goals, tasks })
    this.store.put('messages', {
      id: randomUUID(),
      at: new Date(this.clock()).toISOString(),
      role: 'user',
      text: 'Saved the roadmap for this goal.',
      channel: 'goal',
      goalId: goal.id,
      details: {
        type: 'changes-accept',
        payload: JSON.stringify({ decisionId: review.decisionId }),
      },
    })
    this.changed()
    return this.store.view()
  }
  async importSchedule(file: {
    name: string
    data: Buffer
    images?: string[]
  }): Promise<ScheduleImportResult> {
    if (file.data.byteLength > 8_000_000) throw new Error('Choose a file smaller than 8 MB.')
    const extension = extname(file.name).toLowerCase()
    let content = ''
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      if (!file.images?.length)
        throw new Error('dAIly could not prepare that image. Try a PNG or JPEG timetable.')
      content = 'Read the attached college timetable image.'
    } else if (extension === '.csv') {
      content = file.data.toString('utf8').slice(0, 25000)
    } else if (extension === '.xlsx') {
      const workbook = new ExcelJS.Workbook()
      const workbookBytes = Buffer.alloc(file.data.byteLength)
      file.data.copy(workbookBytes)
      await workbook.xlsx.load(workbookBytes.buffer, {
        ignoreNodes: ['drawing', 'picture', 'shape', 'extLst'],
      })
      const sheet = workbook.worksheets[0]
      if (!sheet || sheet.rowCount > 200 || sheet.columnCount > 24)
        throw new Error(
          'Choose an Excel timetable with one sheet of at most 200 rows and 24 columns.',
        )
      const rows: string[] = []
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = []
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          if (col <= 24) values.push(`${col}:${String(cell.text || '').slice(0, 120)}`)
        })
        if (values.length) rows.push(values.join(' | '))
      })
      content = rows.join('\n').slice(0, 25000)
    } else throw new Error('Choose a PNG, JPEG, WEBP, CSV, or XLSX timetable file.')
    if (!content.trim()) throw new Error('This file does not contain a readable timetable.')
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const prompt = `Read this college schedule. Return only the start and end time of the entire college day for each clearly readable weekday. Ignore individual class periods, subjects, room numbers, and dates. Treat it as a recurring weekly schedule. Use 24-hour HH:mm times. If a weekday or either end time is ambiguous, omit that day and ask one clear confirmation question. Never guess a missing time. Return JSON matching the required schema.\nWeekday numbers: ${weekdays.map((name, index) => `${index}=${name}`).join(', ')}\nInput:\n${content}`
    const answer = await this.planner.modelDecision(
      [
        {
          role: 'system',
          content:
            'Extract only clear evidence. Do not infer holidays or dated overrides. Ask about uncertainty.',
        },
        { role: 'user', content: prompt, ...(file.images?.length ? { images: file.images } : {}) },
      ],
      {
        type: 'object',
        additionalProperties: false,
        required: ['days', 'questions'],
        properties: {
          days: {
            type: 'array',
            maxItems: 7,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['weekday', 'start', 'end'],
              properties: {
                weekday: { type: 'integer', minimum: 0, maximum: 6 },
                start: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
                end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
              },
            },
          },
          questions: { type: 'array', maxItems: 7, items: { type: 'string' } },
        },
      },
    )
    const extraction = parseScheduleExtraction(answer)
    return { filename: basename(file.name), extraction }
  }
  confirmSchedule(input: unknown): Snapshot {
    const { days }: ScheduleReview = ScheduleReviewSchema.parse(input)
    const config = this.store.config()
    const college = config.timetable.filter((item) => !item.date && item.title === 'College')
    const timetable = [
      ...config.timetable.filter((item) => !college.some((old) => old.id === item.id)),
      ...days.map((day) => ({
        id: randomUUID(),
        weekday: day.weekday,
        date: null,
        title: 'College',
        start: day.start,
        end: day.end,
        cancelled: false,
      })),
    ]
    const result = this.store.saveConfig({ ...config, timetable })
    this.changed()
    return result
  }
}

function explicitCollegeHoliday(
  text: string,
  now: DateTime,
): { date: string; weekday: number } | undefined {
  if (!text.trim()) return undefined
  const subject =
    '(?:no college|college holiday|holiday from college|(?:classes?|lectures?) (?:are|is)? ?cancelled|cancel(?:led|ed) classes)'
  const when =
    '(today|tomorrow|(?:this|next)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday)'
  const match = text.match(
    new RegExp(
      '(?:' +
        subject +
        '\\s+(?:on\\s+)?' +
        when +
        '|' +
        when +
        '\\s+(?:is|are)\\s+(?:a\\s+)?(?:holiday|off)|' +
        when +
        '\\s+(?:has|have)\\s+no\\s+college)',
      'i',
    ),
  )
  const phrase = match?.slice(1).find(Boolean)?.toLowerCase()
  if (!phrase) return undefined
  const weekdayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  let date = now.startOf('day')
  if (phrase === 'tomorrow') date = date.plus({ days: 1 })
  else if (phrase !== 'today') {
    const day = phrase.split(/\\s+/).at(-1)!
    const delta = (weekdayNames.indexOf(day) - (date.weekday % 7) + 7) % 7
    date = date.plus({ days: delta + (phrase.startsWith('next ') ? 7 : 0) })
  }
  return { date: date.toISODate()!, weekday: date.weekday % 7 }
}
