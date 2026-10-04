import type { CheckIn, Config, Snapshot } from './state'
import type { DownloadProgress, ModelStatus } from './ai'
export interface DesktopBridge {
  platform: string
  getVersion(): Promise<string>
  getState(): Promise<Snapshot>
  saveConfig(config: Config): Promise<Snapshot>
  saveCheckIn(checkIn: CheckIn): Promise<Snapshot>
  onState(callback: (state: Snapshot) => void): () => void
  modelStatus(): Promise<ModelStatus>
  downloadModel(): Promise<void>
  cancelModel(): Promise<void>
  openOllamaDownload(): Promise<void>
  onDownload(callback: (progress: DownloadProgress) => void): () => void
}
