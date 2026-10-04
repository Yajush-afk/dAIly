import { mkdirSync, existsSync, unlinkSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { Store } from '../src/main/store'
import { defaultProfile, type Task } from '../src/shared/state'
const directory = resolve('artifacts/demo-recording/user-data'),
  database = join(directory, 'daily.db')
const owner = join(directory, 'demo-process.json')
if (existsSync(owner)) {
  const parsed: unknown = JSON.parse(readFileSync(owner, 'utf8'))
  const pid = parsed && typeof parsed === 'object' && 'pid' in parsed ? Number(parsed.pid) : NaN
  if (!Number.isInteger(pid) || pid < 1)
    throw new Error('The demo process marker is invalid. Close dAIly before removing it.')
  let alive = true
  try {
    process.kill(pid, 0)
  } catch (error) {
    alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
  if (alive) throw new Error('Quit the demo app from its tray before seeding or resetting a take.')
}
const argumentPath = (flag: string) => {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a file path`)
  return resolve(value)
}
const exportPath = argumentPath('--export'),
  importPath = argumentPath('--import')
if (exportPath && importPath) throw new Error('Export and import must be separate commands.')
if (exportPath || importPath) {
  const source = importPath ?? database,
    destination = exportPath ?? database
  if (source === destination) throw new Error('Choose a path outside the active demo database.')
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`)
  if (existsSync(destination) && (!importPath || !process.argv.includes('--reset')))
    throw new Error('Destination exists. For import, add --reset to replace the demo take.')
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true })
  try {
    if (sourceDb.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('The source database failed its integrity check.')
    const version = Number(sourceDb.pragma('user_version', { simple: true }))
    if (
      version < 1 ||
      version > 4 ||
      !sourceDb.prepare("SELECT value FROM metadata WHERE key = 'profile'").get()
    )
      throw new Error('This is not a supported dAIly database.')
    mkdirSync(dirname(destination), { recursive: true })
    // Backup includes committed WAL contents and produces a self-contained SQLite file.
    const staging = destination + '.transfer'
    if (existsSync(staging)) throw new Error(`Remove the leftover transfer file first: ${staging}`)
    try {
      await sourceDb.backup(staging)
      if (importPath)
        for (const suffix of ['', '-wal', '-shm']) {
          if (existsSync(destination + suffix)) unlinkSync(destination + suffix)
        }
      renameSync(staging, destination)
    } finally {
      if (existsSync(staging)) unlinkSync(staging)
    }
  } finally {
    sourceDb.close()
  }
  console.log(
    `${importPath ? 'Imported demo database' : 'Exported portable database'}: ${destination}`,
  )
  process.exit(0)
}
mkdirSync(directory, { recursive: true })
if (existsSync(database) && !process.argv.includes('--reset')) {
  console.log(
    'Using the existing demo database. To start a new take, close the demo app and run npm run demo:reset.',
  )
  process.exit(0)
}
if (process.argv.includes('--reset'))
  for (const suffix of ['', '-wal', '-shm']) {
    const file = database + suffix
    if (existsSync(file)) unlinkSync(file)
  }
const today = DateTime.now().setZone('Asia/Kolkata'),
  dsa = randomUUID(),
  gsoc = randomUUID()
const task = (goalId: string, title: string, estimateMinutes: number): Task => ({
  id: randomUUID(),
  goalId,
  title,
  estimateMinutes,
  deadline: null,
  status: 'todo',
})
const tasks = [
  task(dsa, 'DP', 1200),
  task(dsa, 'Revision of patterns', 600),
  task(dsa, 'Mock OA/Contests', 600),
  task(gsoc, 'Read issue #129 in org1', 60),
  task(gsoc, 'Babysit and merge #14035 in org2', 60),
]
const store = new Store(database)
try {
  store.saveConfig({
    profile: {
      ...defaultProfile,
      name: 'Kushagra',
      timezone: 'Asia/Kolkata',
      focusMinutes: 180,
      breakMinutes: 10,
      bedtime: '02:30',
      wakeTime: '08:00',
      quietStart: '02:30',
      quietEnd: '08:00',
      quietDuringSleep: true,
      notifications: false,
      arrivalCheckIn: false,
      launchAtLogin: false,
      onboardingComplete: true,
    },
    goals: [
      {
        id: dsa,
        title: 'DSA for interviews',
        priority: 5,
        deadline: today.plus({ months: 5 }).toISODate(),
        preferredDailyMinutes: 120,
        preferredDailyNote: 'Flexible when college work or an urgent deadline needs time.',
        notes:
          'Prepare for online assessments and interviews. Polish DP, revise patterns, and practise timed problems.',
      },
      {
        id: gsoc,
        title: 'Prepare for GSoC',
        priority: 4,
        deadline: today.plus({ months: 2 }).toISODate(),
        preferredDailyMinutes: 60,
        preferredDailyNote: 'Flexible around college and interview preparation.',
        notes: 'Understand project issues and follow contributions through review and CI.',
      },
    ],
    tasks,
    timetable: [
      [1, '08:00', '17:00'],
      [2, '13:00', '16:00'],
      [3, '09:00', '15:00'],
      [4, '10:00', '16:00'],
      [5, '08:30', '14:30'],
    ].map(([weekday, start, end]) => ({
      id: randomUUID(),
      weekday: Number(weekday),
      start: String(start),
      end: String(end),
      title: 'College',
      date: null,
      cancelled: false,
    })),
  })
  const samples = [
    {
      days: 2,
      hour: 19,
      task: tasks[0],
      minutes: 45,
      outcome: 'partial' as const,
      work: 'Worked through two DP examples and reviewed their transitions.',
      interruption: '',
    },
    {
      days: 2,
      hour: 20,
      task: tasks[3],
      minutes: 25,
      outcome: 'partial' as const,
      work: 'Read issue #129 in org1 and noted where to inspect the code.',
      interruption: '',
    },
    {
      days: 1,
      hour: 19,
      task: tasks[1],
      minutes: 40,
      outcome: 'partial' as const,
      work: 'Revised sliding-window and binary-search patterns.',
      interruption: '',
    },
    {
      days: 1,
      hour: 20,
      task: tasks[4],
      minutes: 25,
      outcome: 'interrupted' as const,
      work: 'Checked review feedback and CI for #14035 in org2.',
      interruption: 'Waiting for CI before the next step.',
    },
  ]
  for (const sample of samples) {
    const start = today
        .minus({ days: sample.days })
        .set({ hour: sample.hour, minute: 0, second: 0, millisecond: 0 })
        .toUTC(),
      end = start.plus({ minutes: sample.minutes }),
      blockId = randomUUID()
    store.put('plans', {
      id: randomUUID(),
      createdAt: start.toISO()!,
      contextRevision: store.revision,
      inputRevision: store.planningRevision,
      status: 'superseded',
      summary: 'Sample planning history for the recording.',
      blocks: [
        {
          id: blockId,
          taskId: sample.task.id,
          kind: 'focus',
          title: sample.task.title,
          start: start.toISO()!,
          end: end.toISO()!,
          reason: 'A concrete step toward a saved goal.',
        },
      ],
      deferred: [],
    })
    store.put('sessions', {
      id: randomUUID(),
      taskId: sample.task.id,
      taskTitle: sample.task.title,
      blockId,
      startedAt: start.toISO()!,
      segmentStartedAt: null,
      targetMinutes: sample.minutes,
      elapsedSeconds: sample.minutes * 60,
      state: 'finished',
      outcome: sample.outcome,
      work: sample.work,
      interruption: sample.interruption,
      finishedAt: end.toISO()!,
      needsReconciliation: false,
    })
  }
  writeFileSync(
    resolve('artifacts/demo-recording/README.txt'),
    `Sample data for the dAIly demo, seeded on ${today.toISODate()}.\nTwo goals, five subtasks, and two days of sample session history.\nNo current plan, check-in, assignment, ML goal, or conversation is prefilled.\nThis is separate from normal application data.\n`,
  )
  console.log(`Demo database ready: ${database}`)
  console.log(
    'Sample history: two days ago 70 minutes; yesterday 65 minutes. ML and today’s assignment will be added live.',
  )
} finally {
  store.close()
}
