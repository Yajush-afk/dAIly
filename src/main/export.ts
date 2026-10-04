import type { Snapshot } from '../shared/state'
import { MODEL } from '../shared/ai'
export function serializeExport(
  state: Snapshot,
  version: string,
  at = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: 'daily-local-export',
      formatVersion: 1,
      applicationVersion: version,
      exportedAt: at,
      model: MODEL,
      state,
    },
    null,
    2,
  )
}
