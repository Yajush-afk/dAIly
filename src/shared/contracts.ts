import type { CheckIn, Config, Snapshot } from './state'
import type { DownloadProgress, ModelStatus } from './ai'
import type { MentorResult } from './planner'
import type { SessionAction } from './session'
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
  askMentor(text: string): Promise<MentorResult>
  acceptPlan(id: string): Promise<Snapshot>
  sessionAction(command: SessionAction): Promise<Snapshot>
  exportData(): Promise<{ cancelled: boolean; path?: string }>
}
