import type { Snapshot } from './state'

export function isDayConfirmation(text: string): boolean {
  return /^(?:yes|yeah|yep|ok(?:ay)?|proceed|works|go ahead|sounds good|do it)[.!\s]*$/i.test(
    text.trim(),
  )
}

export function resolveDayIntent(
  text: string,
  intent: 'plan' | 'conversation',
  state: Snapshot,
): 'plan' | 'conversation' {
  if (intent === 'plan') return intent
  if (
    /^\s*(?:why|how|what|explain|tell me why)\b|\b(?:don't|do not)\s+(?:adjust|update|change|create)\b/i.test(
      text,
    )
  )
    return intent
  if (
    /\b(?:adjust|revise|update|change|create|make|generate)\b.{0,80}\b(?:plan|schedule)\b|\bplan\s+(?:my|the|this|our|today)|\binstead of\b/is.test(
      text,
    )
  )
    return 'plan'
  if (!isDayConfirmation(text)) return intent
  const last = [...state.messages].reverse().find((message) => message.role === 'mentor')
  if (last?.details?.type === 'decision') {
    try {
      if (JSON.parse(last.details.payload).decision?.kind === 'propose_plan') return 'plan'
    } catch {
      /* Older or damaged message details cannot establish a pending proposal. */
    }
  }
  // A short confirmation can continue a schedule discussion after a restart.
  // It requests a reviewable proposal, never accepts or starts a plan.
  if (
    last &&
    /\b(plan|schedule|focus block|minutes|assignment)\b/i.test(last.text) &&
    /\b(confirm|proceed|sound|align|right|good)\b/i.test(last.text)
  )
    return 'plan'
  return intent
}
