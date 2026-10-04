export function isTrustedRendererUrl(candidate: string, expected: string): boolean {
  try {
    const actual = new URL(candidate)
    const trusted = new URL(expected)
    return actual.protocol === trusted.protocol && actual.host === trusted.host && actual.pathname === trusted.pathname
  } catch { return false }
}
