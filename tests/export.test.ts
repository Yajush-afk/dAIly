import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { serializeExport } from '../src/main/export'
import { CheckInSchema } from '../src/shared/state'
import { randomUUID } from 'node:crypto'
describe('release data', () => {
  it('exports a versioned complete snapshot without changing stored state', () => {
    const store = new Store(':memory:'), before = store.snapshot()
    const exported = JSON.parse(serializeExport(before, '0.1.0', '2026-10-04T00:00:00.000Z'))
    expect(exported.formatVersion).toBe(1); expect(exported.state).toEqual(before)
    expect(store.snapshot()).toEqual(before); store.close()
  })
  it('rejects backwards unavailable intervals at the IPC boundary', () => {
    expect(() => CheckInSchema.parse({ id: randomUUID(), at: '2026-10-04T00:00:00.000Z', availableUntil: null, energy: 'unknown', note: '', busy: [{ start: '2026-10-04T02:00:00.000Z', end: '2026-10-04T01:00:00.000Z', title: 'Invalid' }] })).toThrow('end after')
  })
})
