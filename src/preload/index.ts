import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/contracts'

const bridge: DesktopBridge = { platform: process.platform, getVersion: () => ipcRenderer.invoke('app:version') }
contextBridge.exposeInMainWorld('dAIly', bridge)
