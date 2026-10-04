import type { CheckIn, Config, Snapshot } from './state'
export interface DesktopBridge {
  platform: string
  getVersion(): Promise<string>
  getState(): Promise<Snapshot>
  saveConfig(config: Config): Promise<Snapshot>
  saveCheckIn(checkIn: CheckIn): Promise<Snapshot>
  onState(callback: (state: Snapshot) => void): () => void
}
