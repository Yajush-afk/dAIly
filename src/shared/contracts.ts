export interface DesktopBridge {
  platform: string
  getVersion(): Promise<string>
}
