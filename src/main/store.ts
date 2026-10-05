import { DateTime } from 'luxon'
import Database from 'better-sqlite3'
import {
  ConfigSchema,
  defaultProfile,
  ProfileSchema,
  TaskSchema,
  schemas,
  type Config,
  type RecordKind,
  type Snapshot,
  type Profile,
  type FocusSession,
} from '../shared/state'
import { decisionConstraints } from './policy'
import type { HistoryPage, HistoryQuery, DashboardSummary } from '../shared/history'

const planningProfile = (p: Profile) => ({
  name: p.name,
  timezone: p.timezone,
  commuteMinutes: p.commuteMinutes,
  bedtime: p.bedtime,
  wakeTime: p.wakeTime,
  focusMinutes: p.focusMinutes,
  breakMinutes: p.breakMinutes,
})
export class Store {
  readonly db: Database.Database
  private cachedConfig?: Config
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.function('daily_date', { deterministic: true }, (at, zone) =>
      DateTime.fromISO(String(at), { zone: String(zone) }).toISODate(),
    )
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 4) {
      this.db.close()
      throw new Error('This database belongs to a newer dAIly version')
    }
    try {
      this.transaction(() => {
        if (version < 1) {
          this.db.exec(
            'CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, id)); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;',
          )
          this.db.prepare('INSERT INTO metadata VALUES (?, ?)').run('revision', '0')
        }
        if (version < 2)
          this.db.exec(
            'CREATE TABLE notifications (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL); PRAGMA user_version = 2;',
          )
        if (version < 3) {
          this.db.exec(`CREATE INDEX records_order ON records(kind);
          CREATE INDEX records_time ON records(kind, COALESCE(json_extract(value, '$.startedAt'), json_extract(value, '$.createdAt'), json_extract(value, '$.at')));
          CREATE INDEX records_state ON records(kind, json_extract(value, '$.state'));
          CREATE INDEX records_status ON records(kind, json_extract(value, '$.status'));
          CREATE INDEX sessions_block ON records(json_extract(value, '$.blockId')) WHERE kind = 'sessions';
          CREATE UNIQUE INDEX sessions_active ON records(kind) WHERE kind = 'sessions' AND json_extract(value, '$.state') != 'finished';
          CREATE TABLE diagnostics (id INTEGER PRIMARY KEY, at TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE proposal_approvals (decision_id TEXT PRIMARY KEY, at TEXT NOT NULL);
          PRAGMA user_version = 3;`)
          this.db
            .prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)')
            .run('planning_revision', '0')
        }
        if (version < 4) {
          this.db.exec(
            `UPDATE records SET value = json_set(value, '$.priority', 6 - CAST(json_extract(value, '$.priority') AS INTEGER)) WHERE kind = 'goals';
            ${version >= 3 ? "UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'planning_revision';" : ''}
            PRAGMA user_version = 4;`,
          )
        }
        if (!this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('profile'))
          this.db
            .prepare('INSERT INTO metadata VALUES (?, ?)')
            .run('profile', JSON.stringify(defaultProfile))
      })
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  transaction<T>(work: () => T): T {
    try {
      return this.db.transaction(work)()
    } catch (error) {
      this.cachedConfig = undefined
      throw error
    }
  }
  private metadata(key: string): string {
    return (
      this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string }
    ).value
  }
  get revision(): number {
    return Number(this.metadata('revision'))
  }
  get planningRevision(): number {
    return Number(this.metadata('planning_revision'))
  }
  setDayGoalPreference(goalId: string, until: string): void {
    if (!this.config().goals.some((goal) => goal.id === goalId)) throw new Error('Unknown goal')
    this.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)')
        .run('day_goal_preference', JSON.stringify({ goalId, until }))
      this.bump(true)
    })
  }
  private dayGoalPreference(now: number): string | undefined {
    const saved = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get('day_goal_preference') as { value: string } | undefined
    if (!saved) return undefined
    const preference = JSON.parse(saved.value) as { goalId: string; until: string }
    return Date.parse(preference.until) > now &&
      this.config().goals.some((g) => g.id === preference.goalId)
      ? preference.goalId
      : undefined
  }
  private bump(planning: boolean): void {
    this.db
      .prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'")
      .run()
    if (planning)
      this.db
        .prepare(
          "UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'planning_revision'",
        )
        .run()
  }
  profile(): Profile {
    return { ...this.configuration().profile }
  }
  config(): Config {
    return structuredClone(this.configuration())
  }
  private configuration(): Config {
    return (this.cachedConfig ??= {
      profile: ProfileSchema.parse(JSON.parse(this.metadata('profile'))),
      goals: this.list('goals'),
      tasks: this.list('tasks'),
      timetable: this.list('timetable'),
    })
  }
  list<K extends RecordKind>(kind: K): Snapshot[K] {
    return this.query(kind, 'ORDER BY rowid', [])
  }
  private query<K extends RecordKind>(
    kind: K,
    suffix: string,
    args: (string | number)[],
  ): Snapshot[K] {
    return (
      this.db.prepare(`SELECT value FROM records WHERE kind = ? ${suffix}`).all(kind, ...args) as {
        value: string
      }[]
    ).map((row) => schemas[kind].parse(JSON.parse(row.value))) as Snapshot[K]
  }
  get<K extends RecordKind>(kind: K, id: string): Snapshot[K][number] | undefined {
    return this.query(kind, 'AND id = ?', [id])[0]
  }
  activeSession(): FocusSession | undefined {
    return this.query('sessions', "AND json_extract(value, '$.state') != 'finished' LIMIT 1", [])[0]
  }
  sessionForBlock(blockId: string): FocusSession | undefined {
    return this.query('sessions', "AND json_extract(value, '$.blockId') = ? LIMIT 1", [blockId])[0]
  }
  private recent<K extends RecordKind>(kind: K, since: number): Snapshot[K] {
    return this.query(
      kind,
      "AND COALESCE(json_extract(value, '$.startedAt'), json_extract(value, '$.createdAt'), json_extract(value, '$.at')) >= ? ORDER BY rowid",
      [new Date(since).toISOString()],
    )
  }
  private latest<K extends RecordKind>(kind: K, limit: number): Snapshot[K] {
    return this.query(kind, 'ORDER BY rowid DESC LIMIT ?', [limit]).reverse() as Snapshot[K]
  }
  goalConversation(goalId: string, limit = 8): Snapshot['messages'] {
    return this.query(
      'messages',
      "AND json_extract(value, '$.channel') = 'goal' AND json_extract(value, '$.goalId') = ? AND COALESCE(json_extract(value, '$.details.type'), '') != 'changes-accept' ORDER BY rowid DESC LIMIT ?",
      [goalId, limit],
    ).reverse()
  }
  dailyConversation(limit = 4): Snapshot['messages'] {
    return this.query(
      'messages',
      "AND (json_extract(value, '$.channel') IS NULL OR json_extract(value, '$.channel') = 'day') ORDER BY rowid DESC LIMIT ?",
      [limit],
    ).reverse()
  }
  runtimeState(now = Date.now()): Snapshot {
    return {
      profile: this.profile(),
      timetable: this.configuration().timetable,
      goals: [],
      tasks: [],
      revision: this.revision,
      planningRevision: this.planningRevision,
      checkIns: this.recent('checkIns', now - 18 * 3600000),
      plans: [],
      sessions: [],
      messages: [],
    }
  }
  invalidatePlanningInputs(): void {
    this.transaction(() => this.bump(true))
  }
  activeTemporaryTasks(now: number): Snapshot['tasks'] {
    const tasks = new Map<string, Snapshot['tasks'][number]>()
    for (const plan of this.openPlans())
      for (const task of plan.temporaryTasks || []) {
        if (task.goalId === null && task.temporaryUntil && Date.parse(task.temporaryUntil) > now)
          tasks.set(task.id, task)
      }
    const completed = new Set(
      this.recent('sessions', now - 7 * 86400000)
        .filter((session) => session.outcome === 'completed')
        .map((session) => session.taskId),
    )
    return [...tasks.values()].map((task) => ({
      ...task,
      status: completed.has(task.id) ? 'done' : task.status,
    }))
  }
  planningState(now: number): Snapshot {
    return {
      ...this.runtimeState(now),
      ...this.config(),
      preferredGoalId: this.dayGoalPreference(now),
      tasks: [...this.config().tasks, ...this.activeTemporaryTasks(now)],
      plans: this.recent('plans', now - 7 * 86400000),
      sessions: this.recent('sessions', now - 7 * 86400000),
      messages: this.dailyConversation(),
    }
  }
  view(now = Date.now()): Snapshot {
    const active = this.activeSession()
    const sessions = this.latest('sessions', 32)
    if (active && !sessions.some((s) => s.id === active.id)) sessions.push(active)
    const plans = this.query(
      'plans',
      "AND json_extract(value, '$.status') IN ('proposed', 'accepted') ORDER BY rowid DESC LIMIT 2",
      [],
    ).reverse()
    return {
      ...this.runtimeState(now),
      ...this.config(),
      recurringDeferrals: decisionConstraints(this.planningState(now), now)
        .repeatedObstacles.filter((o) => o.deferredDays >= 3)
        .map((o) => ({ taskId: o.taskId, deferredDays: o.deferredDays })),
      plans,
      sessions,
      messages: this.latest('messages', 20),
    }
  }
  // Full snapshots are reserved for explicit exports and migration verification.
  snapshot(): Snapshot {
    return {
      ...this.config(),
      revision: this.revision,
      planningRevision: this.planningRevision,
      checkIns: this.list('checkIns'),
      plans: this.list('plans'),
      sessions: this.list('sessions'),
      messages: this.list('messages'),
    }
  }
  history(query: HistoryQuery): HistoryPage {
    const sessionDate =
      "COALESCE(json_extract(value, '$.finishedAt'), json_extract(value, '$.startedAt'))"
    const range = (expression: string): string =>
      `${query.from ? ` AND ${expression} >= @from` : ''}${query.until ? ` AND ${expression} < @until` : ''}`
    const parameters = {
      ...(query.from ? { from: query.from } : {}),
      ...(query.until ? { until: query.until } : {}),
    }
    const suffix =
      query.kind === 'sessions' ? "AND json_extract(value, '$.state') = 'finished'" : ''
    const rows = this.db
      .prepare(
        `SELECT rowid AS cursor, value FROM records WHERE kind = @kind ${suffix}${range(query.kind === 'sessions' ? sessionDate : "json_extract(value, '$.createdAt')")} AND rowid < @before ORDER BY rowid DESC LIMIT @limit`,
      )
      .all({
        ...parameters,
        kind: query.kind,
        before: query.before ?? Number.MAX_SAFE_INTEGER,
        limit: query.limit + 1,
      }) as { cursor: number; value: string }[]
    const page = rows.slice(0, query.limit)
    const values = page.map((row) => schemas[query.kind].parse(JSON.parse(row.value)))
    const filter = `kind = 'sessions' AND json_extract(value, '$.state') = 'finished'${range(sessionDate)}`
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(json_extract(value, '$.elapsedSeconds')), 0) AS seconds FROM records WHERE ${filter}`,
      )
      .get(parameters) as { sessions: number; seconds: number }
    const byGoal = this.db
      .prepare(
        `SELECT CASE WHEN goal.id IS NULL THEN NULL ELSE json_extract(task.value, '$.goalId') END AS goalId, COUNT(*) AS sessions, COALESCE(SUM(json_extract(session.value, '$.elapsedSeconds')), 0) AS seconds FROM records session LEFT JOIN records task ON task.kind = 'tasks' AND task.id = json_extract(session.value, '$.taskId') LEFT JOIN records goal ON goal.kind = 'goals' AND goal.id = json_extract(task.value, '$.goalId') WHERE session.kind = 'sessions' AND json_extract(session.value, '$.state') = 'finished'${range("COALESCE(json_extract(session.value, '$.finishedAt'), json_extract(session.value, '$.startedAt'))")} GROUP BY goalId ORDER BY seconds DESC`,
      )
      .all(parameters) as HistoryPage['totals']['byGoal']
    const byDay = this.db
      .prepare(
        `SELECT daily_date(${sessionDate}, @zone) AS date, COUNT(*) AS sessions, COALESCE(SUM(json_extract(value, '$.elapsedSeconds')), 0) AS seconds FROM records WHERE ${filter} GROUP BY date ORDER BY date`,
      )
      .all({
        ...parameters,
        zone: this.config().profile.timezone,
      }) as HistoryPage['totals']['byDay']
    return {
      kind: query.kind,
      sessions: query.kind === 'sessions' ? (values as Snapshot['sessions']) : [],
      plans: query.kind === 'plans' ? (values as Snapshot['plans']) : [],
      next: rows.length > query.limit ? page.at(-1)!.cursor : null,
      totals: {
        ...totals,
        byGoal,
        byDay,
      },
    }
  }
  dashboardSummary(now = Date.now()): DashboardSummary {
    const today = DateTime.fromMillis(now, { zone: this.config().profile.timezone }).startOf('day')
    const yesterday = today.minus({ days: 1 })
    const history = this.history({
      kind: 'sessions',
      from: yesterday.toUTC().toISO()!,
      until: today.toUTC().toISO()!,
      limit: 3,
    })
    const pending = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM records WHERE kind = 'sessions' AND json_extract(value, '$.state') = 'awaiting-outcome'",
      )
      .get() as { count: number }
    return {
      date: today.toISODate()!,
      yesterday: {
        date: yesterday.toISODate()!,
        sessions: history.totals.sessions,
        seconds: history.totals.seconds,
        recentWork: history.sessions,
      },
      pendingOutcomes: pending.count,
    }
  }
  put<K extends RecordKind>(kind: K, value: Snapshot[K][number]): void {
    const parsed = schemas[kind].parse(value)
    if (kind === 'tasks' && TaskSchema.parse(value).goalId === null)
      throw new Error('Temporary work must be embedded in a plan, not saved as a goal task.')
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value',
        )
        .run(kind, parsed.id, JSON.stringify(parsed))
      this.bump(['goals', 'tasks', 'timetable', 'checkIns', 'sessions'].includes(kind))
    })
    if (['goals', 'tasks', 'timetable'].includes(kind)) this.cachedConfig = undefined
  }
  saveConfig(input: Config): Snapshot {
    const config = ConfigSchema.parse(input)
    const goalIds = new Set(config.goals.map((goal) => goal.id))
    if (config.tasks.some((task) => task.goalId === null || !goalIds.has(task.goalId)))
      throw new Error('Every task must belong to a goal')
    for (const entries of [config.goals, config.tasks, config.timetable])
      if (new Set(entries.map((item) => item.id)).size !== entries.length)
        throw new Error('Duplicate record identifiers')
    const active = this.activeSession()
    if (
      active &&
      !config.tasks.some((task) => task.id === active.taskId) &&
      !this.activeTemporaryTasks(Date.now()).some((task) => task.id === active.taskId)
    )
      throw new Error('Finish the active session before deleting its task')
    const old = this.config()
    const planningChanged =
      JSON.stringify({ ...old, profile: planningProfile(old.profile) }) !==
      JSON.stringify({ ...config, profile: planningProfile(config.profile) })
    this.transaction(() => {
      this.db
        .prepare('UPDATE metadata SET value = ? WHERE key = ?')
        .run(JSON.stringify(config.profile), 'profile')
      for (const kind of ['goals', 'tasks', 'timetable'] as const) {
        this.db.prepare('DELETE FROM records WHERE kind = ?').run(kind)
        for (const item of config[kind])
          this.db
            .prepare('INSERT INTO records VALUES (?, ?, ?)')
            .run(kind, item.id, JSON.stringify(item))
      }
      this.bump(planningChanged)
    })
    this.cachedConfig = undefined
    return this.view()
  }
  recordDiagnostic(value: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO diagnostics(at, value) VALUES (?, ?)')
      .run(new Date().toISOString(), JSON.stringify(value))
    this.db
      .prepare('DELETE FROM diagnostics WHERE id <= (SELECT MAX(id) - 1000 FROM diagnostics)')
      .run()
  }
  diagnostics(): unknown[] {
    return (
      this.db.prepare('SELECT value FROM diagnostics ORDER BY id DESC LIMIT 20').all() as {
        value: string
      }[]
    ).map((r) => JSON.parse(r.value))
  }
  openPlans(): Snapshot['plans'] {
    return this.query(
      'plans',
      "AND json_extract(value, '$.status') IN ('proposed', 'accepted') ORDER BY rowid",
      [],
    )
  }
  proposalApplied(id: string): boolean {
    return !!this.db
      .prepare('SELECT decision_id FROM proposal_approvals WHERE decision_id = ?')
      .get(id)
  }
  recordApproval(id: string, now: number): void {
    this.db
      .prepare('INSERT INTO proposal_approvals VALUES (?, ?)')
      .run(id, new Date(now).toISOString())
  }
  notificationSent(key: string): boolean {
    return !!this.db.prepare('SELECT key FROM notifications WHERE key = ?').get(key)
  }
  recordNotification(key: string, now: number): void {
    this.db.prepare('INSERT INTO notifications VALUES (?, ?)').run(key, new Date(now).toISOString())
  }
  close(): void {
    this.db.close()
  }
}
