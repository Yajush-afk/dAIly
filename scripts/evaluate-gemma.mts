import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Store } from '../src/main/store'
import { Planner } from '../src/main/planner'
import { OllamaClient } from '../src/main/ollama'
import { defaultProfile } from '../src/shared/state'

const client = new OllamaClient()
if (!(await client.status()).ready) throw new Error('Install Ollama and download the configured model before evaluating.')
const reports: object[] = []
for (const name of ['exam-tomorrow', 'low-energy-short-evening', 'repeated-interruption']) {
  const store = new Store(':memory:'), now = Date.parse('2026-10-04T14:30:00Z')
  const exam = randomUUID(), dsa = randomUUID(), examTask = randomUUID(), dsaTask = randomUUID()
  store.saveConfig({ profile: { ...defaultProfile, timezone: 'Asia/Kolkata', onboardingComplete: true }, goals: [{ id: exam, title: 'Exams', priority: 1, deadline: '2026-10-05' }, { id: dsa, title: 'DSA', priority: 2, deadline: null }], tasks: [{ id: examTask, goalId: exam, title: 'Revise two end-semester topics', estimateMinutes: 45, deadline: '2026-10-05', status: 'todo' }, { id: dsaTask, goalId: dsa, title: 'Solve one graph problem', estimateMinutes: 30, deadline: null, status: 'todo' }], timetable: [] })
  store.put('checkIns', { id: randomUUID(), at: new Date(now).toISOString(), availableUntil: new Date(now + (name === 'low-energy-short-evening' ? 20 : 120) * 60000).toISOString(), energy: name === 'low-energy-short-evening' ? 'low' : 'okay', note: 'I got home from college.', busy: [] })
  if (name === 'repeated-interruption') for (let i = 1; i <= 3; i++) store.put('sessions', { id: randomUUID(), taskId: dsaTask, blockId: null, startedAt: new Date(now - i * 86400000).toISOString(), segmentStartedAt: null, targetMinutes: 30, elapsedSeconds: 300, state: 'finished', outcome: 'interrupted', work: 'Read the problem only.', interruption: 'I could not decide how to start.', finishedAt: new Date(now - i * 86400000 + 300000).toISOString(), needsReconciliation: false })
  let calls = 0, invalid = 0
  const measured = { chat: async (...args: Parameters<OllamaClient['chat']>) => { calls++; const response = await client.chat(...args); try { JSON.parse(response.content) } catch { invalid++ } return response } }
  const started = performance.now()
  try {
    const result = await new Planner(store, measured, () => now).request('Propose a practical plan for this evening using my reported availability and actual work, unless rest is more useful.')
    const ps = await fetch('http://127.0.0.1:11434/api/ps').then(r => r.json())
    reports.push({ name, passed: true, calls, repairs: calls - 1, invalidJson: invalid, totalMs: Math.round(performance.now() - started), result, plans: store.snapshot().plans, ollamaRuntime: ps, factualReview: 'Requires human review of explanation against scenario. Structural and scheduling checks are automated.' })
  } catch (error) { reports.push({ name, passed: false, calls, invalidJson: invalid, totalMs: Math.round(performance.now() - started), error: String(error) }) }
  finally { store.close() }
  console.log(JSON.stringify(reports.at(-1)))
}
mkdirSync('artifacts', { recursive: true })
writeFileSync('artifacts/gemma-evaluation.json', JSON.stringify({ evaluatedAt: new Date().toISOString(), platform: process.platform, reports }, null, 2))
