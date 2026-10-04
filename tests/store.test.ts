import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/store'
import { defaultProfile, type Config } from '../src/shared/state'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(): { path: string; config: Config } {
  const root = mkdtempSync(join(tmpdir(), 'daily-test-'))
  roots.push(root)
  const goalId = randomUUID()
  return {
    path: join(root, 'daily.db'),
    config: {
      profile: { ...defaultProfile, onboardingComplete: true },
      goals: [{ id: goalId, title: 'DSA', priority: 2, deadline: null }],
      tasks: [
        {
          id: randomUUID(),
          goalId,
          title: 'Solve a graph problem',
          estimateMinutes: 45,
          deadline: null,
          status: 'todo',
        },
      ],
      timetable: [],
    },
  }
}
describe('local records', () => {
  it('migrates a new database and preserves configuration after reopening', () => {
    const { path, config } = fixture()
    const first = new Store(path)
    first.saveConfig(config)
    expect(first.db.pragma('user_version', { simple: true })).toBe(3)
    first.close()
    const reopened = new Store(path)
    expect(reopened.snapshot().tasks).toEqual(config.tasks)
    expect(reopened.snapshot().profile.onboardingComplete).toBe(true)
    reopened.close()
  })
  it('rejects invalid references without changing existing state', () => {
    const { path, config } = fixture()
    const store = new Store(path)
    store.saveConfig(config)
    const before = store.snapshot()
    expect(() =>
      store.saveConfig({ ...config, tasks: [{ ...config.tasks[0], goalId: randomUUID() }] }),
    ).toThrow('belong to a goal')
    expect(store.snapshot()).toEqual(before)
    expect(() =>
      store.saveConfig({ ...config, goals: [config.goals[0], config.goals[0]] }),
    ).toThrow('Duplicate')
    store.close()
  })
})
