import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { OllamaClient } from '../src/main/ollama'
import { defaultProfile } from '../src/shared/state'

const client = new OllamaClient()
if (!(await client.status()).ready)
  throw new Error('Install Ollama and download the configured model before evaluating.')
const reports: { passed: boolean; [key: string]: unknown }[] = []
const repeats = Number(process.argv.find((arg) => arg.startsWith('--repeats='))?.split('=')[1] || 1)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw new Error('Use --repeats=1 through --repeats=10')
const prompts = [
  'Propose a practical plan for this evening using my reported availability and actual work, unless rest is more useful.',
  'What should I do next with the time I have left? Please consider my energy, deadlines, and what happened recently.',
  'Help me pick a realistic next step. I cannot fit every goal today. Explain what can wait.',
]
for (let iteration = 0; iteration < repeats; iteration++)
  for (const name of [
    'exam-tomorrow',
    'low-energy-short-evening',
    'repeated-interruption',
    'no-time-left',
    'completed-task',
    'conflicting-deadlines',
  ]) {
    const store = new Store(':memory:'),
      now = Date.parse('2026-10-04T14:30:00Z')
    const exam = randomUUID(),
      dsa = randomUUID(),
      examTask = randomUUID(),
      dsaTask = randomUUID()
    store.saveConfig({
      profile: { ...defaultProfile, timezone: 'Asia/Kolkata', onboardingComplete: true },
      goals: [
        { id: exam, title: 'Exams', priority: 1, deadline: '2026-10-05' },
        { id: dsa, title: 'DSA', priority: 2, deadline: null },
      ],
      tasks: [
        {
          id: examTask,
          goalId: exam,
          title: 'Revise two end-semester topics',
          estimateMinutes: 45,
          deadline: '2026-10-05',
          status: 'todo',
        },
        {
          id: dsaTask,
          goalId: dsa,
          title: 'Solve one graph problem',
          estimateMinutes: 30,
          deadline: null,
          status: 'todo',
        },
      ],
      timetable: [],
    })
    if (name === 'completed-task')
      store.put('tasks', { ...store.snapshot().tasks[1], status: 'done' })
    if (name === 'conflicting-deadlines') {
      store.put('goals', { ...store.snapshot().goals[0], deadline: '2026-10-12' })
      store.put('tasks', { ...store.snapshot().tasks[0], deadline: '2026-10-12' })
      store.put('goals', {
        ...store.snapshot().goals[1],
        title: 'Internships',
        priority: 3,
        deadline: '2026-10-04',
      })
      store.put('tasks', {
        ...store.snapshot().tasks[1],
        title: 'Submit internship application',
        estimateMinutes: 20,
        deadline: '2026-10-04',
      })
    }
    store.put('checkIns', {
      id: randomUUID(),
      at: new Date(now).toISOString(),
      availableUntil: new Date(
        now +
          (name === 'no-time-left' ? 0 : name === 'low-energy-short-evening' ? 20 : 120) * 60000,
      ).toISOString(),
      energy: name === 'low-energy-short-evening' ? 'low' : 'okay',
      note: 'I got home from college.',
      busy: [],
    })
    if (name === 'repeated-interruption')
      for (let i = 1; i <= 3; i++)
        store.put('sessions', {
          id: randomUUID(),
          taskId: dsaTask,
          blockId: null,
          startedAt: new Date(now - i * 86400000).toISOString(),
          segmentStartedAt: null,
          targetMinutes: 30,
          elapsedSeconds: 300,
          state: 'finished',
          outcome: 'interrupted',
          work: 'Read the problem only.',
          interruption: 'I could not decide how to start.',
          finishedAt: new Date(now - i * 86400000 + 300000).toISOString(),
          needsReconciliation: false,
        })
    let calls = 0,
      invalid = 0
    const measured = {
      chat: async (...args: Parameters<OllamaClient['chat']>) => {
        calls++
        const response = await client.chat(...args)
        try {
          JSON.parse(response.content)
        } catch {
          invalid++
        }
        return response
      },
    }
    const started = performance.now()
    try {
      const result = await new Planner(store, measured, () => now).request(
        prompts[iteration % prompts.length],
      )
      const plans = store.snapshot().plans,
        focus = plans.flatMap((p) => p.blocks).filter((b) => b.kind === 'focus')
      const scenarioChecks = {
        respectsCutoff: focus.every(
          (b) => Date.parse(b.end) <= Date.parse(store.snapshot().checkIns.at(-1)!.availableUntil!),
        ),
        excludesCompletedWork: focus.every(
          (b) => store.snapshot().tasks.find((t) => t.id === b.taskId)?.status === 'todo',
        ),
        lowEnergyLimit:
          name !== 'low-energy-short-evening' ||
          (result.decision.kind === 'propose_plan' &&
            focus.length > 0 &&
            focus.every((b) => Date.parse(b.end) - Date.parse(b.start) <= 20 * 60000)),
        stopsWhenTimeEnds:
          name !== 'no-time-left' || (result.origin === 'availability' && !focus.length),
        nearerDeadlineFirst: name !== 'conflicting-deadlines' || focus[0]?.taskId === dsaTask,
        examFirst: name !== 'exam-tomorrow' || focus[0]?.taskId === examTask,
        changesRepeatedAttempt:
          name !== 'repeated-interruption' ||
          (result.decision.kind === 'ask_question' &&
            /start|obstacle|hard|stuck|decide/i.test(result.decision.question)) ||
          (result.decision.kind === 'propose_plan' &&
            result.decision.choices.filter((c) => c.taskId === dsaTask).length > 0 &&
            result.decision.choices
              .filter((c) => c.taskId === dsaTask)
              .every((c) => c.minutes < 30)) ||
          (result.decision.kind === 'propose_changes' &&
            result.decision.tasks.some(
              (task) =>
                task.goalId === dsa &&
                task.estimateMinutes <
                  (store.snapshot().tasks.find((item) => item.id === dsaTask)?.estimateMinutes ||
                    0),
            )),
        summaryMatchesScheduledWork:
          result.decision.kind !== 'propose_plan' ||
          result.decision.choices.every((choice) =>
            focus.some((block) => block.taskId === choice.taskId),
          ) ||
          focus.length === 0 ||
          plans[0]?.summary.includes(focus[0].title) === true,
      }
      const ps = await fetch('http://127.0.0.1:11434/api/ps').then((r) => r.json())
      reports.push({
        name,
        iteration: iteration + 1,
        passed: Object.values(scenarioChecks).every(Boolean),
        scenarioChecks,
        calls,
        repairs: Math.max(0, calls - 1),
        invalidJson: invalid,
        totalMs: Math.round(performance.now() - started),
        result,
        plans,
        ollamaRuntime: ps,
        factualReview:
          'Requires human review of explanation against scenario. Structural and scheduling checks are automated.',
      })
    } catch (error) {
      const unchanged = store.snapshot()
      const safelyRejected =
        name === 'completed-task' &&
        String(error).includes('existing plan is unchanged') &&
        unchanged.tasks.find((task) => task.id === dsaTask)?.status === 'done' &&
        unchanged.plans.length === 0 &&
        unchanged.sessions.length === 0
      reports.push({
        name,
        iteration: iteration + 1,
        passed: safelyRejected,
        safelyRejected,
        calls,
        invalidJson: invalid,
        totalMs: Math.round(performance.now() - started),
        error: String(error),
        factualReview:
          'The model did not produce a usable plan. The harness safely rejected its response and preserved task, plan, and session state.',
      })
    } finally {
      store.close()
    }
    console.log(JSON.stringify(reports.at(-1)))
  }
mkdirSync('artifacts', { recursive: true })
writeFileSync(
  'artifacts/gemma-evaluation.json',
  JSON.stringify(
    { evaluatedAt: new Date().toISOString(), platform: process.platform, repeats, reports },
    null,
    2,
  ),
)
if (reports.some((r) => !r.passed)) process.exitCode = 1
