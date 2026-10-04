import type { TemporaryTaskReview } from './temporary-tasks'
import type { CheckIn, Config, Snapshot } from './state'
import type { DownloadProgress, ModelStatus } from './ai'
import type { MentorResult } from './planner'
import type { SessionAction } from './session'
import type { DayUpdate, ReviewedChanges, WorkflowResult } from './workflow'
import type { HistoryQuery, HistoryPage, DashboardSummary } from './history'
import type { GoalDiscussionInput, GoalDiscussionResult, RoadmapReview } from './goal-mentor'
import type { ScheduleImportResult, ScheduleReview } from './timetable-import'
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
  askMentor(
    text: string,
    intent?: 'plan' | 'conversation',
    images?: string[],
  ): Promise<MentorResult>
  discussGoal(input: GoalDiscussionInput): Promise<GoalDiscussionResult>
  approveRoadmap(input: RoadmapReview): Promise<Snapshot>
  importSchedule(): Promise<ScheduleImportResult | undefined>
  confirmSchedule(input: ScheduleReview): Promise<Snapshot>
  clearPlan(): Promise<Snapshot>
  reviewTemporaryTasks(review: TemporaryTaskReview): Promise<WorkflowResult>
  acceptPlan(id: string): Promise<Snapshot>
  sessionAction(command: SessionAction): Promise<Snapshot>
  checkInAndPlan(update: DayUpdate): Promise<WorkflowResult>
  recordOutcome(command: Extract<SessionAction, { action: 'outcome' }>): Promise<WorkflowResult>
  approveChanges(review: ReviewedChanges): Promise<Snapshot>
  getDashboardSummary(): Promise<DashboardSummary>
  getHistory(query: HistoryQuery): Promise<HistoryPage>
  exportData(): Promise<{ cancelled: boolean; path?: string }>
}
