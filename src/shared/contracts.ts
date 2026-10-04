import type { CheckIn, Config, Snapshot } from './state'
import type { DownloadProgress, ModelStatus } from './ai'
import type { MentorResult } from './planner'
import type { SessionAction } from './session'
import type { DayUpdate, ReviewedChanges, WorkflowResult } from './workflow'
import type { HistoryQuery, HistoryPage } from './history'
export type StateUpdate = Partial<Snapshot> & { revision: number }
export interface DesktopBridge {
  platform: string
  getVersion(): Promise<string>
  getState(): Promise<Snapshot>
  saveConfig(config: Config): Promise<Snapshot>
  saveCheckIn(checkIn: CheckIn): Promise<Snapshot>
  onState(callback: (state: StateUpdate) => void): () => void
  modelStatus(): Promise<ModelStatus>
  downloadModel(): Promise<void>
  cancelModel(): Promise<void>
  openOllamaDownload(): Promise<void>
  onDownload(callback: (progress: DownloadProgress) => void): () => void
  askMentor(text: string, intent?: 'plan' | 'conversation'): Promise<MentorResult>
  acceptPlan(id: string): Promise<Snapshot>
  sessionAction(command: SessionAction): Promise<Snapshot>
  checkInAndPlan(update: DayUpdate): Promise<WorkflowResult>
  recordOutcome(command: Extract<SessionAction, { action: 'outcome' }>): Promise<WorkflowResult>
  approveChanges(review: ReviewedChanges): Promise<Snapshot>
  getHistory(query: HistoryQuery): Promise<HistoryPage>
  exportData(): Promise<{ cancelled: boolean; path?: string }>
}
