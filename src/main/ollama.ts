import { z } from 'zod'
import { MODEL, type ChatMessage, type DownloadProgress, type ModelStatus } from '../shared/ai'

export class OllamaClient {
  private active?: AbortController
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async status(): Promise<ModelStatus> {
    try {
      const response = await this.fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })
      if (!response.ok) throw new Error('Ollama did not respond successfully')
      const tags = z.object({ models: z.array(z.object({ name: z.string() })) }).parse(await response.json())
      return { running: true, ready: tags.models.some(model => model.name === MODEL), model: MODEL }
    } catch { return { running: false, ready: false, model: MODEL, error: 'Ollama is not available. Open Ollama on this laptop, then retry.' } }
  }
  cancel(): void { this.active?.abort() }
  private async request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active) throw new Error('Another model request is running. Wait or cancel it first.')
    const controller = new AbortController(); this.active = controller
    try { return await operation(controller.signal) }
    catch (error) { if (controller.signal.aborted) throw new Error('Request cancelled'); throw error }
    finally { if (this.active === controller) this.active = undefined }
  }
  async pull(progress: (value: DownloadProgress) => void): Promise<void> {
    return this.request(async signal => {
      const response = await this.fetcher('http://127.0.0.1:11434/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, stream: true }), signal })
      if (!response.ok || !response.body) throw new Error('Model download could not start. Check Ollama and your internet connection.')
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let successful = false
      const consume = (line: string): void => {
        if (!line.trim()) return
        const chunk = z.object({ status: z.string().optional(), error: z.string().optional(), completed: z.number().optional(), total: z.number().optional() }).parse(JSON.parse(line))
        if (chunk.error) throw new Error(chunk.error)
        if (chunk.status === 'success') successful = true
        progress({ status: chunk.status || 'Downloading', completed: chunk.completed, total: chunk.total })
      }
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) consume(line) }
        buffer += decoder.decode(); consume(buffer)
        if (!successful) throw new Error('Download ended before completion. Retry to resume it.')
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    })
  }
  async chat(messages: ChatMessage[], format: unknown): Promise<{ content: string; durationMs: number; tokens: number }> {
    return this.request(async signal => {
      const started = performance.now()
      const response = await this.fetcher('http://127.0.0.1:11434/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        body: JSON.stringify({ model: MODEL, messages, format, stream: false, keep_alive: '5m', options: { num_ctx: 4096, num_predict: 768, temperature: 0.1 } })
      })
      if (!response.ok) throw new Error(`Ollama could not generate a response (${response.status}). Check model setup and retry.`)
      const result = z.object({ message: z.object({ content: z.string() }), eval_count: z.number().optional() }).parse(await response.json())
      return { content: result.message.content, durationMs: Math.round(performance.now() - started), tokens: result.eval_count || 0 }
    })
  }
}
