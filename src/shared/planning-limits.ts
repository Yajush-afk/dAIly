export const planningLimits = {
  minimumBlockMinutes: 5,
  maximumBlockMinutes: 120,
  lowEnergyMinutes: 20,
  maximumChoices: 2,
  maximumAttempts: 2,
  contextCharacters: 10000,
  tasksInContext: 16,
  outcomesInContext: 8,
  historyPageSize: 20,
} as const
