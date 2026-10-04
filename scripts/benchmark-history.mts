import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { Sessions } from '../src/main/sessions'
import { defaultProfile } from '../src/shared/state'

const root = mkdtempSync(join(tmpdir(), 'daily-benchmark-'))
const store = new Store(join(root, 'daily.db')),
  now = Date.now(),
  goalId = randomUUID(),
  taskId = randomUUID()
store.saveConfig({
  profile: { ...defaultProfile, onboardingComplete: true },
  goals: [{ id: goalId, title: 'DSA', priority: 1, deadline: null }],
  tasks: [
    {
      id: taskId,
      goalId,
      title: 'Review graphs',
      status: 'todo',
      estimateMinutes: 20,
      deadline: null,
    },
  ],
  timetable: [],
})
const sessions = new Sessions(store)
function measure(label: string) {
  const samples = []
  for (let i = 0; i < 200; i++) {
    const start = performance.now()
    sessions.tick()
    store.runtimeState(now)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const start = performance.now(),
    page = store.history({ kind: 'sessions', limit: 20 })
  return {
    label,
    tickMedianMs: samples[100],
    tickP95Ms: samples[190],
    firstHistoryPageMs: performance.now() - start,
    recordsInPage: page.sessions.length,
    nextPage: page.next !== null,
    viewBytes: JSON.stringify(store.view()).length,
  }
}
const baseline = measure('empty-history')
store.transaction(() => {
  for (let i = 0; i < 3650; i++) {
    const at = new Date(now - (i + 1) * 86400000).toISOString()
    store.put('sessions', {
      id: randomUUID(),
      taskId,
      blockId: null,
      startedAt: at,
      segmentStartedAt: null,
      targetMinutes: 20,
      elapsedSeconds: 900,
      state: 'finished',
      outcome: 'partial',
      work: 'Reviewed an example.',
      interruption: '',
      finishedAt: at,
      needsReconciliation: false,
    })
    store.put('plans', {
      id: randomUUID(),
      createdAt: at,
      contextRevision: 0,
      status: 'superseded',
      summary: 'A saved earlier plan',
      blocks: [],
      deferred: [],
    })
  }
  for (let i = 0; i < 20000; i++)
    store.put('messages', {
      id: randomUUID(),
      at: new Date(now - i * 3600000).toISOString(),
      role: 'user',
      text: 'A short update about a previous day.',
    })
})
store.put('sessions', {
  id: randomUUID(),
  taskId,
  blockId: null,
  startedAt: new Date(now).toISOString(),
  segmentStartedAt: new Date(now).toISOString(),
  targetMinutes: 20,
  elapsedSeconds: 0,
  state: 'running',
  outcome: null,
  work: '',
  interruption: '',
  finishedAt: null,
  needsReconciliation: false,
})
store.db.pragma('wal_checkpoint(TRUNCATE)')
const loaded = measure('27300-history-records')
const report = {
  at: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  records: 27300,
  baseline,
  loaded,
  note: 'Temporary on-disk SQLite database on this Linux host, including an active session. Not a Windows benchmark or a proof of arbitrary scale.',
}
mkdirSync('artifacts', { recursive: true })
writeFileSync('artifacts/history-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
store.close()
rmSync(root, { recursive: true, force: true })
