import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from '../src/main/security'

describe('renderer trust boundary', () => {
  it('accepts the local entrypoint with a navigation hash', () => {
    expect(isTrustedRendererUrl('file:///app/index.html#today', 'file:///app/index.html')).toBe(true)
  })
  it('rejects foreign origins, paths and malformed URLs', () => {
    const trusted = 'http://127.0.0.1:5173/'
    for (const url of ['https://example.com/', 'http://127.0.0.1:5173/untrusted', 'javascript:alert(1)', 'invalid']) {
      expect(isTrustedRendererUrl(url, trusted)).toBe(false)
    }
  })
})
