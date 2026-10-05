import { DateTime } from 'luxon'
import {
  temporaryTaskExtractionSchemaForUpdate,
  parseTemporaryTaskExtraction,
} from '../shared/temporary-tasks'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DecisionSchema, type MentorResult } from '../shared/planner'
import type { ChatMessage } from '../shared/ai'
import type { Snapshot } from '../shared/state'
import { availableIntervals, currentCheckIn, schedule } from './scheduler'
import type { Store } from './store'
import type { OllamaClient } from './ollama'
import { decisionConstraints, orderPlanChoices, validateDecision } from './policy'
import { planningLimits } from '../shared/planning-limits'
import type { GoalDiscussionInput } from '../shared/goal-mentor'
import { isGoalReference, requestedGoal, isUrgentTask } from './planning-preference'
export { decisionConstraints } from './policy'

export function planningContext(state: Snapshot, now: number, currentRequest = '') {
  const week = now - 7 * 86400000
  const goals = new Map(state.goals.map((g) => [g.id, g]))
  const deadline = (task: Snapshot['tasks'][number]): string =>
    [task.deadline, goals.get(task.goalId || '')?.deadline]
      .filter((d): d is string => !!d)
      .sort()[0] || '9999'
  const todo = state.tasks.filter((t) => t.status === 'todo')
  const tasks = [...todo]
    .filter(
      (task) =>
        !state.preferredGoalId ||
        task.goalId === null ||
        task.goalId === state.preferredGoalId ||
        isUrgentTask(state, task, now),
    )
    .sort(
      (a, b) =>
        Number(b.goalId === null) - Number(a.goalId === null) ||
        deadline(a).localeCompare(deadline(b)) ||
        (goals.get(b.goalId || '')?.priority || 1) - (goals.get(a.goalId || '')?.priority || 1),
    )
    .slice(0, planningLimits.tasksInContext)
    .map((t) => ({
      ...t,
      title: t.title.slice(0, 160),
      goalPriority: goals.get(t.goalId || '')?.priority ?? 5,
      goalTitle: goals.get(t.goalId || '')?.title ?? null,
      goalDeadline: goals.get(t.goalId || '')?.deadline ?? null,
      preferredDailyMinutes: goals.get(t.goalId || '')?.preferredDailyMinutes ?? null,
      remainingEstimateMinutes:
        t.estimateMinutes === null
          ? null
          : Math.max(
              0,
              t.estimateMinutes -
                Math.round(
                  state.sessions
                    .filter((session) => session.taskId === t.id && session.state === 'finished')
                    .reduce((seconds, session) => seconds + session.elapsedSeconds, 0) / 60,
                ),
            ),
      goalNotes: goals.get(t.goalId || '')?.notes?.slice(0, 240) ?? '',
    }))
  const checkIn = currentCheckIn(state, now)
  const limits = decisionConstraints(state, now)
  const context = {
    currentRequest: currentRequest.slice(0, 4000),
    preferredGoalId: state.preferredGoalId ?? null,
    confirmedTemporaryTasks: tasks.filter((task) => task.goalId === null),
    now: new Date(now).toISOString(),
    revision: state.revision,
    decisionConstraints: {
      ...limits,
      repeatedObstacles: limits.repeatedObstacles.filter((o) =>
        tasks.some((t) => t.id === o.taskId),
      ),
    },
    profile: {
      name: state.profile.name.slice(0, 100),
      timezone: state.profile.timezone,
      bedtime: state.profile.bedtime,
      focusMinutes: state.profile.focusMinutes,
      breakMinutes: state.profile.breakMinutes,
    },
    availableIntervals: availableIntervals(state, now).map((i) => ({
      start: new Date(i.start).toISOString(),
      end: new Date(i.end).toISOString(),
    })),
    goals: [...state.goals]
      .sort(
        (a, b) =>
          Number(tasks.some((t) => t.goalId === b.id)) -
            Number(tasks.some((t) => t.goalId === a.id)) || b.priority - a.priority,
      )
      .slice(0, planningLimits.tasksInContext)
      .map((g) => ({
        ...g,
        title: g.title.slice(0, 100),
        notes: g.notes?.slice(0, 240) ?? '',
        preferredDailyMinutes: g.preferredDailyMinutes ?? null,
        preferredDailyNote: g.preferredDailyNote?.slice(0, 120) ?? '',
      })),
    tasks,
    omittedTaskCount: todo.length - tasks.length,
    omittedGoalCount: Math.max(0, state.goals.length - 16),
    latestCheckIn: checkIn
      ? {
          ...checkIn,
          note: checkIn.note.slice(0, 600),
          busy: checkIn.busy.map((b) => ({ ...b, title: b.title.slice(0, 60) })),
        }
      : null,
    recentOutcomes: state.sessions
      .filter((s) => Date.parse(s.startedAt) >= week)
      .slice(-planningLimits.outcomesInContext)
      .map((s) => ({
        taskId: s.taskId,
        date: s.startedAt,
        targetMinutes: s.targetMinutes,
        elapsedSeconds: s.elapsedSeconds,
        outcome: s.outcome,
        work: s.work.slice(0, 160),
        interruption: s.interruption.slice(0, 120),
      })),
    recentDeferrals: state.plans
      .filter((p) => Date.parse(p.createdAt) >= week)
      .slice(-3)
      .map((p) => ({
        at: p.createdAt,
        deferred: p.deferred
          .filter((d) => tasks.some((t) => t.id === d.taskId))
          .slice(0, 6)
          .map((d) => ({ taskId: d.taskId, reason: d.reason.slice(0, 100) })),
      })),
    conversation: state.messages
      .slice(-4)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 600) })),
  }
  // Bound serialized context as well as record counts. A collection of individually
  // valid long notes must not crowd the system instructions out of Gemma's context.
  while (JSON.stringify(context).length > planningLimits.contextCharacters) {
    if (context.conversation.length > 1) context.conversation.shift()
    else if (context.recentOutcomes.length > 3) context.recentOutcomes.shift()
    else if (context.recentDeferrals.length) context.recentDeferrals.shift()
    else if (context.goals.some((g) => !context.tasks.some((t) => t.goalId === g.id))) {
      const index = context.goals.findIndex((g) => !context.tasks.some((t) => t.goalId === g.id))
      context.goals.splice(index, 1)
      context.omittedGoalCount++
    } else if (context.tasks.length > 1) {
      context.tasks.pop()
      context.omittedTaskCount++
      context.goals = context.goals.filter((g) => context.tasks.some((t) => t.goalId === g.id))
      context.omittedGoalCount = state.goals.length - context.goals.length
      context.decisionConstraints.repeatedObstacles =
        context.decisionConstraints.repeatedObstacles.filter((o) =>
          context.tasks.some((t) => t.id === o.taskId),
        )
    } else if (context.recentOutcomes.length) context.recentOutcomes.shift()
    else if (context.conversation.length) context.conversation.shift()
    else break
  }
  return context
}
const instructions = `You are dAIly, Kushagra's clear and practical college mentor. Reply to Kushagra as a person. Never narrate your hidden reasoning, label fields, quote IDs, or print implementation details such as "Task ID", "minutes:", "reason:", "choices:", or "deferred:". Return only one concise JSON decision. Use only supplied facts and exact task/goal IDs in fields that request IDs. Priority 5 is highest and 1 is lowest. Compare goal priorities, upcoming deadlines, preferred minutes per day, available time, energy, and recent effort. preferredGoalId is an explicit request for this planning day: choose that goal for flexible goal work. Only an imminent deadline can take precedence. Long-term deadlines do not automatically outrank a higher priority. Preferences are targets that may be exceeded or reduced when today's time, exam urgency, or current priority warrants it; explain a meaningful trade-off. Do not repeat a full task the user has repeatedly deferred; ask one direct question about the recorded obstacle or choose a distinct smaller task. Unknown means unknown. Never invent completed work, time spent, or preferences. Preserve concrete task scope. A short focus block can make partial progress; it does not complete a whole task. Low energy calls for one smaller focus block or rest. If an actionable task fits the available time, make a propose_plan with one or more short blocks. Do not answer with generic encouragement or propose task/preference changes just because the user has little time or low energy. Use propose_changes only when the user asks to edit goals, tasks, or preferences, or a distinct new smaller step is needed to unblock repeated difficulty. Never propose a renamed copy of an existing task or a preference value that is already set. Confirmed temporary tasks are real obligations for this planning day. If the response schema has confirmedWork, fill every required task entry with action schedule and minutes, or action defer and a reason. These entries are authoritative and may also appear in choices; never interpret a dismissed new suggestion as cancelling confirmed work. Account for each unfinished temporary task in choices or explicitly defer it with a practical reason. Put urgent deadlines ahead of flexible goal work. A temporary task choice may request up to 120 minutes of total work; the application splits it into preferred focus blocks and inserts breaks. Explain partial work honestly. The app schedules only choices in propose_plan, never text in respond. Choose at most ${planningLimits.maximumChoices} blocks, each within focus preference and available time. A plan has kind, summary, choices [{taskId,minutes,reason}], deferred [{taskId,reason}]. Reasons are short sentences for Kushagra with no identifiers. Include only useful deferrals. Ask one question only if the answer changes the decision. respond is for a brief explanation or stop-for-today only, never disguise a task schedule as prose. Avoid em dashes.`
const readableDecision = (decision: import('../shared/planner').Decision): void => {
  const copy =
    decision.kind === 'propose_plan'
      ? [
          decision.summary,
          ...decision.choices.map((choice) => choice.reason),
          ...decision.deferred.map((item) => item.reason),
        ].join(' ')
      : decision.kind === 'propose_changes'
        ? decision.explanation + ' ' + decision.tasks.map((task) => task.title).join(' ')
        : decision.kind === 'propose_temporary_tasks'
          ? decision.explanation
          : decision.kind === 'ask_question'
            ? decision.question
            : decision.explanation
  if (
    /task\s*id|\bminutes\s*[:=]|\breason\s*[:=]|\b(kind|choices|deferred)\s*[:=]|acknowledging your situation and prioritizing/i.test(
      copy,
    )
  )
    throw new Error(
      'Use a direct sentence for Kushagra. Never display task IDs, schema field names, or narration about your hidden reasoning.',
    )
}

function confirmedWorkSchema(state: Snapshot) {
  return z
    .object(
      Object.fromEntries(
        state.tasks
          .filter((task) => task.goalId === null && task.status === 'todo')
          .map((task) => [
            task.id,
            z.discriminatedUnion('action', [
              z
                .object({
                  action: z.literal('schedule'),
                  minutes: z.number().int().min(5).max(180),
                  reason: z.string().trim().min(1).max(1000),
                })
                .strict(),
              z
                .object({ action: z.literal('defer'), reason: z.string().trim().min(1).max(1000) })
                .strict(),
            ]),
          ]),
      ),
    )
    .strict()
}
export function parsePlanningDecision(content: string, state: Snapshot) {
  const raw = JSON.parse(content, (_key, value: unknown) =>
    typeof value === 'string' ? value.replaceAll('—', '; ') : value,
  )
  if (raw.kind === 'propose_plan' && raw.confirmedWork !== undefined) {
    const { confirmedWork, ...fields } = raw
    const work = confirmedWorkSchema(state).parse(confirmedWork)
    const plan = DecisionSchema.options[1].parse(fields)
    const ids = new Set(Object.keys(work))
    plan.choices = plan.choices.filter((choice) => !ids.has(choice.taskId))
    plan.deferred = plan.deferred.filter((item) => !ids.has(item.taskId))
    for (const [taskId, disposition] of Object.entries(work)) {
      if (disposition.action === 'schedule')
        plan.choices.push({ taskId, minutes: disposition.minutes, reason: disposition.reason })
      else plan.deferred.push({ taskId, reason: disposition.reason })
    }
    return DecisionSchema.parse(plan)
  }
  return DecisionSchema.parse(raw)
}

export function modelFormat(
  state: Snapshot,
  allowPlanning = true,
  context?: { tasks: { id: string }[]; goals: { id: string }[] },
): unknown {
  const taskIds = (context?.tasks || state.tasks.filter((t) => t.status === 'todo')).map(
      (t) => t.id,
    ),
    goalIds = (context?.goals || state.goals).map((g) => g.id)
  const options = [
    DecisionSchema.options[0],
    ...(allowPlanning && taskIds.length
      ? [
          state.tasks.some((t) => t.goalId === null && t.status === 'todo')
            ? DecisionSchema.options[1].extend({ confirmedWork: confirmedWorkSchema(state) })
            : DecisionSchema.options[1],
        ]
      : []),
    ...(allowPlanning &&
    goalIds.length &&
    !state.tasks.some((task) => task.goalId === null && task.status === 'todo')
      ? [DecisionSchema.options[2]]
      : []),
    DecisionSchema.options[3],
  ]
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (key === 'taskId' && item && typeof item === 'object' && taskIds.length)
            return [key, { type: 'string', enum: taskIds }]
          if (key === 'goalId' && item && typeof item === 'object' && goalIds.length)
            return [key, { type: 'string', enum: goalIds }]
          return [key, bind(item)]
        }),
      )
    return value
  }
  return bind(z.toJSONSchema(z.union([options[0], options[1], ...options.slice(2)])))
}

export class Planner {
  private pending = false
  constructor(
    private store: Store,
    private model: Pick<OllamaClient, 'chat'>,
    private clock = Date.now,
  ) {}
  async discussGoal(
    input: GoalDiscussionInput,
    state: Snapshot,
    messages: ChatMessage[],
    format: unknown,
    validate?: (answer: string) => void,
  ): Promise<string> {
    if (!state.goals.some((goal) => goal.id === input.goalId))
      throw new Error('This goal is no longer available.')
    // Compare decoded fields. JSON escapes quotes, newlines, and backslashes,
    // so searching the serialized envelope for the original text is unreliable.
    const lastMessage = messages.at(-1)
    const context = z
      .object({ goal: z.object({ id: z.string() }), currentRequest: z.string() })
      .safeParse(
        (() => {
          try {
            return JSON.parse(lastMessage?.content || '') as unknown
          } catch {
            return undefined
          }
        })(),
      )
    if (
      lastMessage?.role !== 'user' ||
      !context.success ||
      context.data.currentRequest !== input.text ||
      context.data.goal.id !== input.goalId
    )
      throw new Error('Goal discussion context is incomplete.')
    return this.modelDecision(messages, format, { maxTokens: 1536, validate })
  }
  async modelDecision(
    messages: ChatMessage[],
    format: unknown,
    options: { maxTokens?: number; validate?: (answer: string) => void } = {},
  ): Promise<string> {
    if (this.pending)
      throw new Error('A model request is already running. Wait or cancel it first.')
    this.pending = true
    try {
      const request = [...messages]
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = (await this.model.chat(request, format, options)).content
        try {
          options.validate?.(answer)
          return answer
        } catch (error) {
          if (attempt === 1)
            throw new Error(
              'dAIly could not prepare a valid goal response. Your conversation and saved goal are intact. Try sending again.',
            )
          request.push({ role: 'assistant', content: answer.slice(0, 6000) })
          let feedback = String(error)
          if (error instanceof z.ZodError) {
            const value: unknown = JSON.parse(answer)
            feedback = error.issues
              .map((issue) => {
                const received = issue.path.reduce<unknown>((current, key) => {
                  if (!current || typeof current !== 'object') return undefined
                  return Reflect.get(current, key)
                }, value)
                const date =
                  typeof received === 'string' ? received.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
                let detail = issue.message
                if (issue.code === 'invalid_format' && issue.format === 'date' && date) {
                  const year = Number(date[1]),
                    month = Number(date[2])
                  if (month >= 1 && month <= 12) {
                    const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
                    detail = `${received} is not a real calendar date. ${date[1]}-${date[2]} has only ${days} days. Choose a valid day.`
                  }
                }
                return `${issue.path.join('.')}: ${detail}; received ${JSON.stringify(received)}`
              })
              .join('\n')
          }
          request.push({
            role: 'user',
            content: `Your previous response was invalid: ${feedback.slice(0, 1200)}. Correct the response above and return a complete JSON object matching the schema, with double-quoted keys and no trailing commas. Dates must be real calendar dates in YYYY-MM-DD format. Keep all valid topics and their supplied IDs. Keep the explanation under three sentences. The user has not seen the failed response; explain only the final recommendation without mentioning errors, validation, retries, or apologizing. If you proposed a roadmap, repair it rather than switching to a discuss response to avoid validation. When the user delegates the recommendation, suggest an order rather than asking them for percentages.`,
          })
        }
      }
      throw new Error('No model response was produced.')
    } finally {
      this.pending = false
    }
  }
  async request(
    text: string,
    intent: 'plan' | 'conversation' = 'plan',
    images: string[] = [],
    discoverTemporaryTasks = false,
  ): Promise<MentorResult> {
    if (this.pending) throw new Error('A planning request is already running')
    this.pending = true
    const started = performance.now(),
      requestId = randomUUID()
    let attempts = 0,
      outcome = 'failed',
      failure = ''
    const validationFailures: string[] = []
    try {
      this.store.put('messages', {
        id: randomUUID(),
        at: new Date(this.clock()).toISOString(),
        role: 'user',
        text,
      })
      const now = this.clock(),
        state = this.store.planningState(now)
      const preferred = requestedGoal(text, state.goals)
      if (intent === 'plan' && preferred) {
        const cutoff = Math.max(
          now,
          ...availableIntervals(state, now).map((interval) => interval.end),
        )
        this.store.setDayGoalPreference(preferred, new Date(cutoff).toISOString())
        state.preferredGoalId = preferred
        state.planningRevision = this.store.planningRevision
        state.revision = this.store.revision
      }
      const hasTime =
        decisionConstraints(state, now).maxBlockMinutes >= planningLimits.minimumBlockMinutes
      if (!hasTime && intent === 'plan') {
        const decision = {
          kind: 'respond' as const,
          explanation:
            'There is no useful time left before your cutoff and commitments. Stop here for today. Update your availability if the situation changes.',
        }
        this.store.put('messages', {
          id: randomUUID(),
          at: new Date(now).toISOString(),
          role: 'mentor',
          text: decision.explanation,
          details: {
            type: 'decision',
            payload: JSON.stringify({ origin: 'availability', decision }),
          },
        })
        outcome = 'availability'
        return { decision, revision: this.store.revision, durationMs: 0, origin: 'availability' }
      }
      const goalRevisionOnly =
        preferred &&
        !/\b(assignment|application|errand|exam|new task|have to|must|due|submit)\b/i.test(text)
      if (discoverTemporaryTasks && intent === 'plan' && hasTime && !goalRevisionOnly) {
        const extractionMessages: ChatMessage[] = [
          {
            role: 'system',
            content: `Identify new one-off work explicitly mentioned in the latest update, such as assignments, applications, errands, or exam preparation. Return tasks only for work the user still needs to do, not completed events, availability, class or college attendance, breaks, existing goals, or existing tasks. Requests to prioritize, squeeze in, or revise an existing goal are plan revisions, not new obligations. Do not interpret "yes", approvals, or rejected suggestions as new tasks. Copy an exact sourceQuote from the update for each task. Infer duration only when explicitly supplied; otherwise use null. Resolve explicit relative deadlines in the saved timezone as YYYY-MM-DD dates, otherwise use null. Never return words such as "today" or "tomorrow" in deadline. Do not invent facts. Today is ${DateTime.fromMillis(now, { zone: state.profile.timezone }).toISODate()}. Return compact JSON {tasks:[{title,estimateMinutes,deadline,sourceQuote}]}; return tasks:[] when there is no new work.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              update: text,
              existingGoals: state.goals.map(({ id, title, priority }) => ({
                id,
                title,
                priority,
              })),
              confirmedTemporaryTasks: state.tasks.filter((task) => task.goalId === null),
              existingTasks: state.tasks.map(({ title, goalId, deadline, estimateMinutes }) => ({
                title,
                goalId,
                deadline,
                estimateMinutes,
              })),
            }),
          },
        ]
        const extractionSchema = temporaryTaskExtractionSchemaForUpdate(text)
        let extracted: import('../shared/temporary-tasks').TemporaryTaskDraft[] = []
        for (let attempt = 0; attempt < planningLimits.maximumAttempts; attempt++) {
          attempts++
          const response = await this.model.chat(
            extractionMessages,
            z.toJSONSchema(extractionSchema),
            { maxTokens: 768 },
          )
          if (this.store.planningRevision !== state.planningRevision)
            throw new Error(
              'Your situation changed while Gemma was thinking. Request a fresh plan.',
            )
          try {
            extracted = parseTemporaryTaskExtraction(
              response.content,
              DateTime.fromMillis(now, { zone: state.profile.timezone }).toISODate()!,
            ).tasks
            if (extracted.some((task) => !text.includes(task.sourceQuote)))
              throw new Error('Each sourceQuote must be copied exactly from the latest update.')
            break
          } catch (error) {
            const category =
              error instanceof z.ZodError
                ? error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`).join(',')
                : error instanceof SyntaxError
                  ? 'invalid_json'
                  : 'source_quote_not_found'
            validationFailures.push(`temporary_task_extraction_invalid:${category}`)
            if (attempt === planningLimits.maximumAttempts - 1)
              throw new Error(
                `dAIly could not check the new work in your update. ${
                  error instanceof z.ZodError
                    ? 'Gemma returned invalid task details.'
                    : error instanceof SyntaxError
                      ? 'Gemma returned an incomplete response.'
                      : 'Gemma changed the wording of your update, so the work could not be verified.'
                } Your existing plan is unchanged. Try again.`,
              )
            extractionMessages.push(
              { role: 'assistant', content: response.content },
              {
                role: 'user',
                content: `Correct the extraction. Deadlines must be real YYYY-MM-DD dates or null, and sourceQuote must be copied exactly. Today is ${DateTime.fromMillis(now, { zone: state.profile.timezone }).toISODate()}. Validation: ${String(error).slice(0, 1000)}`,
              },
            )
          }
        }
        const normalize = (title: string) =>
          title
            .toLocaleLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
        const seen = new Set(state.tasks.map((task) => normalize(task.title)))
        extracted = extracted.filter((task) => {
          if (isGoalReference(task.title, state.goals)) return false
          if (
            /^(?:(?:attend(?:ing)?|go(?:ing)? to)\s+)?(?:full\s+)?(?:college|school|classes)(?:\s+(?:today|tomorrow|all day|full day))?$/i.test(
              task.title.trim(),
            )
          )
            return false
          const key = normalize(task.title)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (extracted.length) {
          const decision = {
            kind: 'propose_temporary_tasks' as const,
            explanation:
              'You mentioned work outside your goals. Add it to this day before I plan the remaining time?',
            tasks: extracted,
            until: new Date(
              Math.max(...availableIntervals(state, now).map((interval) => interval.end)),
            ).toISOString(),
          }
          const decisionId = randomUUID()
          this.store.put('messages', {
            id: decisionId,
            at: new Date(now).toISOString(),
            role: 'mentor',
            channel: 'day',
            text: decision.explanation,
            details: {
              type: 'decision',
              payload: JSON.stringify({ decision, inputRevision: state.planningRevision }),
            },
          })
          outcome = 'temporary_task_review'
          return {
            decision,
            decisionId,
            revision: this.store.revision,
            durationMs: Math.round(performance.now() - started),
            origin: 'gemma',
          }
        }
      }
      if (intent === 'plan' && !state.tasks.some((task) => task.status === 'todo')) {
        const first = [...state.goals].sort((a, b) => b.priority - a.priority)[0]
        const decision = {
          kind: 'ask_question' as const,
          question: first
            ? `I know ${first.title} matters to you, but I need one concrete next step before I can plan a useful focus block. What would you like to move forward?`
            : 'What is one goal you want dAIly to help you make progress on? Add a concrete next step in Goals, then I can plan around it.',
        }
        this.store.put('messages', {
          id: randomUUID(),
          at: new Date(now).toISOString(),
          role: 'mentor',
          text: decision.question,
          channel: 'day',
        })
        outcome = 'missing_tasks'
        return { decision, revision: this.store.revision, durationMs: 0, origin: 'missing_tasks' }
      }
      const context = planningContext(state, now, text)
      const messages: ChatMessage[] = [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify(context) },
      ]
      const format = modelFormat(state, hasTime && intent === 'plan', context)
      if (images?.length) messages[1] = { ...messages[1], images }
      for (let attempt = 0; attempt < planningLimits.maximumAttempts; attempt++) {
        attempts++
        const response = await this.model.chat(messages, format, {
          maxTokens: 1024 + state.tasks.filter((task) => task.goalId === null).length * 128,
        })
        if (this.store.planningRevision !== state.planningRevision)
          throw new Error('Your situation changed while Gemma was thinking. Request a fresh plan.')
        try {
          let decision = orderPlanChoices(
            state,
            parsePlanningDecision(response.content, state),
            now,
          )
          readableDecision(decision)
          if (
            intent === 'plan' &&
            hasTime &&
            state.tasks.some((task) => task.status === 'todo') &&
            decision.kind === 'respond' &&
            !/\b(stop for today|rest today|take a break|go to sleep|no useful time (?:left|remains)|nothing else fits today|continue tomorrow|save it for tomorrow)\b/i.test(
              decision.explanation,
            )
          )
            throw new Error(
              'This is a planning request with available tasks. Propose a scheduled focus block or ask one decision-relevant question. Do not return generic advice in place of a plan.',
            )
          const decisionTime = this.clock()
          validateDecision(state, decision, decisionTime)
          const plan =
            decision.kind === 'propose_plan' ? schedule(state, decision, decisionTime) : undefined
          if (plan && decision.kind === 'propose_plan')
            decision = { ...decision, summary: plan.summary }
          const decisionId = randomUUID()
          this.store.transaction(() => {
            if (plan)
              for (const old of this.store.openPlans().filter((p) => p.status === 'proposed'))
                this.store.put('plans', { ...old, status: 'superseded' })
            if (plan) this.store.put('plans', plan)
            this.store.put('messages', {
              id: decisionId,
              at: new Date(this.clock()).toISOString(),
              role: 'mentor',
              text:
                decision.kind === 'ask_question'
                  ? decision.question
                  : plan
                    ? plan.summary
                    : decision.kind === 'propose_plan'
                      ? decision.summary
                      : decision.explanation,
              details: {
                type: 'decision',
                payload: JSON.stringify({ decision, inputRevision: state.planningRevision }),
              },
            })
          })
          outcome = decision.kind
          return {
            decision,
            decisionId,
            planId: plan?.id,
            revision: this.store.revision,
            durationMs: response.durationMs,
            origin: 'gemma',
          }
        } catch (error) {
          validationFailures.push(
            error instanceof SyntaxError
              ? 'invalid_json'
              : error instanceof z.ZodError
                ? error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`).join(', ')
                : 'decision_constraints_failed',
          )
          if (attempt === planningLimits.maximumAttempts - 1) {
            const confirmed = state.tasks.filter(
              (task) => task.goalId === null && task.status === 'todo',
            )
            if (intent === 'plan' && confirmed.length) {
              const decision = {
                kind: 'ask_question' as const,
                question: `Your confirmed work is still saved: ${confirmed.map((task) => task.title).join(', ')}. Should I reserve time for it before your goal work, or explicitly defer it in this plan?`,
              }
              this.store.put('messages', {
                id: randomUUID(),
                at: new Date(this.clock()).toISOString(),
                role: 'mentor',
                channel: 'day',
                text: decision.question,
                details: {
                  type: 'decision',
                  payload: JSON.stringify({ origin: 'guardrail', decision }),
                },
              })
              outcome = 'guardrail_question'
              return {
                decision,
                revision: this.store.revision,
                durationMs: Math.round(performance.now() - started),
                origin: 'guardrail',
              }
            }
            const obstacle = decisionConstraints(state, this.clock()).repeatedObstacles[0]
            const task = obstacle && state.tasks.find((item) => item.id === obstacle.taskId)
            if (intent === 'plan' && obstacle && task) {
              const decision = {
                kind: 'ask_question' as const,
                question: `You have tried “${task.title}” a few times and got stuck because “${obstacle.reason}”. What part should we make smaller before you try again?`,
              }
              this.store.put('messages', {
                id: randomUUID(),
                at: new Date(this.clock()).toISOString(),
                role: 'mentor',
                text: decision.question,
                channel: 'day',
                details: {
                  type: 'decision',
                  payload: JSON.stringify({ origin: 'guardrail', decision }),
                },
              })
              outcome = 'guardrail_question'
              return {
                decision,
                revision: this.store.revision,
                durationMs: Math.round(performance.now() - started),
                origin: 'guardrail',
              }
            }
            throw new Error(
              `Gemma could not produce a usable decision. Your existing plan is unchanged. ${String(error)}`,
            )
          }
          messages.push(
            { role: 'assistant', content: response.content },
            {
              role: 'user',
              content: `Correct your decision. Validation failed: ${String(error).slice(0, 2000)}`,
            },
          )
        }
      }
      throw new Error('Planning failed')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      failure = message.includes('cancelled')
        ? 'cancelled'
        : message.includes('took too long')
          ? 'timeout'
          : message.includes('changed while')
            ? 'inputs_changed'
            : message.includes('usable decision')
              ? 'validation_failed'
              : 'request_failed'
      throw error
    } finally {
      this.pending = false
      // Diagnostics never include raw prompts, model output, or work descriptions.
      try {
        this.store.recordDiagnostic({
          requestId,
          outcome,
          attempts,
          durationMs: Math.round(performance.now() - started),
          failure,
          validationFailures,
        })
      } catch {
        console.error('Could not save planning diagnostics')
      }
    }
  }
  accept(id: string): Snapshot {
    const plan = this.store.get('plans', id)
    if (!plan || plan.status !== 'proposed') throw new Error('This proposal is no longer available')
    // Only changes to planning inputs invalidate a proposal. Appearance and conversation do not.
    if (plan.inputRevision === undefined || this.store.planningRevision !== plan.inputRevision)
      throw new Error('Your situation changed. Ask for a fresh proposal before accepting.')
    if (
      plan.blocks.some((b) => b.kind === 'focus' && Date.parse(b.start) < this.clock() - 5 * 60000)
    )
      throw new Error('This plan has become outdated. Ask for a fresh proposal.')
    this.store.transaction(() => {
      for (const old of this.store.openPlans())
        this.store.put('plans', { ...old, status: old.id === id ? 'accepted' : 'superseded' })
      this.store.put('messages', {
        id: randomUUID(),
        at: new Date(this.clock()).toISOString(),
        role: 'user',
        text: 'Accepted this plan.',
        details: { type: 'plan-accept', payload: JSON.stringify({ planId: id }) },
      })
    })
    return this.store.view()
  }
}
