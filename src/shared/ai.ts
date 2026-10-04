export const MODEL = 'gemma3:4b-it-q4_K_M'
export interface ModelStatus {
  running: boolean
  ready: boolean
  model: string
  version?: string
  error?: string
}
export interface DownloadProgress {
  status: string
  completed?: number
  total?: number
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}
