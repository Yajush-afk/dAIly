import { useCallback, useEffect, useState } from 'react'
import { MODEL, type DownloadProgress, type ModelStatus } from '../../shared/ai'

export function ModelSetup(): React.JSX.Element {
  const [status, setStatus] = useState<ModelStatus>({ running: false, ready: false, model: MODEL })
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress>()
  const [error, setError] = useState('')
  const refresh = useCallback(async (): Promise<void> => {
    if (!window.dAIly) return
    setLoading(true); setError('')
    try { setStatus(await window.dAIly.modelStatus()) } catch (reason) { setError(String(reason)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh(); return window.dAIly?.onDownload(setProgress) }, [refresh])
  async function download(): Promise<void> {
    if (!window.dAIly) return
    setDownloading(true); setError(''); setProgress(undefined)
    try { await window.dAIly.downloadModel(); await refresh() } catch (reason) { setError(String(reason)) } finally { setDownloading(false) }
  }
  return <section>
    <h2>Local AI</h2>
    <p className="notice">{loading ? 'Checking Ollama...' : status.ready ? 'Gemma is ready on this laptop.' : status.running ? 'Ollama is running. Download Gemma to start planning.' : status.error || 'Open Ollama to use local planning.'}</p>
    <small>{MODEL}. Initial download needs internet. Your planning records stay on this device.</small>
    {error && <p className="error" role="alert">{error}</p>}
    {downloading && <div aria-live="polite"><p className="notice">{progress?.status || 'Starting download...'}</p><progress aria-label="Model download" max={progress?.total || 1} value={progress?.completed} /></div>}
    <div className="actions">
      {!status.running && <button onClick={() => void window.dAIly?.openOllamaDownload()}>Install Ollama for Windows</button>}
      {status.running && !status.ready && <button className="primary" disabled={downloading} onClick={() => void download()}>Download Gemma</button>}
      {downloading ? <button onClick={() => void window.dAIly?.cancelModel()}>Cancel download</button> : <button disabled={loading} onClick={() => void refresh()}>Check again</button>}
    </div>
  </section>
}
