import type { Snapshot } from '../shared/state'
import type { StateUpdate } from '../shared/contracts'
export function stateChanges(previous: Snapshot | undefined, next: Snapshot): StateUpdate {
  const update: StateUpdate = { revision: next.revision }
  for (const key of Object.keys(next) as (keyof Snapshot)[]) {
    if (!previous || JSON.stringify(next[key]) !== JSON.stringify(previous[key]))
      Object.assign(update, { [key]: next[key] })
  }
  return update
}
