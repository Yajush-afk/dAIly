import Database from 'better-sqlite3'
import { ConfigSchema, defaultProfile, ProfileSchema, schemas, type Config, type RecordKind, type Snapshot } from '../shared/state'

export class Store {
  readonly db: Database.Database
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 2) { this.db.close(); throw new Error('This database belongs to a newer dAIly version') }
    if (version < 1) this.db.transaction(() => {
      this.db.exec('CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, id)); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;')
      this.db.prepare('INSERT INTO metadata VALUES (?, ?)').run('revision', '0')
    })()
    if (version < 2) this.db.transaction(() => { this.db.exec('CREATE TABLE notifications (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL); PRAGMA user_version = 2;') })()
    if (!this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('profile')) this.db.prepare('INSERT INTO metadata VALUES (?, ?)').run('profile', JSON.stringify(defaultProfile))
  }
  get revision(): number { return Number((this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('revision') as { value: string }).value) }
  private bump(): void { this.db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(String(this.revision + 1), 'revision') }
  list<K extends RecordKind>(kind: K): Snapshot[K] {
    return (this.db.prepare('SELECT value FROM records WHERE kind = ? ORDER BY rowid').all(kind) as { value: string }[]).map(row => schemas[kind].parse(JSON.parse(row.value))) as Snapshot[K]
  }
  snapshot(): Snapshot {
    const profile = ProfileSchema.parse(JSON.parse((this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('profile') as { value: string }).value))
    return { revision: this.revision, profile, goals: this.list('goals'), tasks: this.list('tasks'), timetable: this.list('timetable'), checkIns: this.list('checkIns'), plans: this.list('plans'), sessions: this.list('sessions'), messages: this.list('messages') }
  }
  put<K extends RecordKind>(kind: K, value: Snapshot[K][number]): void {
    const parsed = schemas[kind].parse(value)
    this.db.transaction(() => { this.db.prepare('INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value').run(kind, parsed.id, JSON.stringify(parsed)); this.bump() })()
  }
  saveConfig(input: Config): Snapshot {
    const config = ConfigSchema.parse(input)
    const goalIds = new Set(config.goals.map(goal => goal.id))
    if (config.tasks.some(task => !goalIds.has(task.goalId))) throw new Error('Every task must belong to a goal')
    for (const entries of [config.goals, config.tasks, config.timetable]) if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error('Duplicate record identifiers')
    const old = this.snapshot()
    const active = old.sessions.find(session => session.state !== 'finished')
    if (active && !config.tasks.some(task => task.id === active.taskId)) throw new Error('Finish the active session before deleting its task')
    this.db.transaction(() => {
      this.db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(JSON.stringify(config.profile), 'profile')
      for (const kind of ['goals', 'tasks', 'timetable'] as const) {
        this.db.prepare('DELETE FROM records WHERE kind = ?').run(kind)
        for (const item of config[kind]) this.db.prepare('INSERT INTO records VALUES (?, ?, ?)').run(kind, item.id, JSON.stringify(item))
      }
      this.bump()
    })()
    return this.snapshot()
  }
  close(): void { this.db.close() }
}
