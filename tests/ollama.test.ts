import { describe, expect, it, vi } from 'vitest'
import { OllamaClient } from '../src/main/ollama'
import { MODEL } from '../src/shared/ai'

describe('local inference connection', () => {
  it('checks the configured model and reports offline availability', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: MODEL }] })))
    expect((await new OllamaClient(fetcher).status()).ready).toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags')
    expect((await new OllamaClient(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))).status()).running).toBe(false)
  })
  it('handles download frames split across network chunks', async () => {
    const stream = new ReadableStream({ start(controller) { const encoder = new TextEncoder(); controller.enqueue(encoder.encode('{"status":"pulling","completed":2,')); controller.enqueue(encoder.encode('"total":4}\n{"status":"success"}\n')); controller.close() } })
    const progress = vi.fn()
    await new OllamaClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream))).pull(progress)
    expect(progress).toHaveBeenCalledWith({ status: 'pulling', completed: 2, total: 4 })
    expect(progress).toHaveBeenLastCalledWith({ status: 'success', completed: undefined, total: undefined })
  })
  it('serializes requests and supports cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) }))
    const client = new OllamaClient(fetcher)
    const first = client.chat([{ role: 'user', content: 'Plan today' }], {})
    const rejection = expect(first).rejects.toThrow('cancelled')
    await expect(client.chat([], {})).rejects.toThrow('Another model request')
    client.cancel(); await rejection
  })
})
