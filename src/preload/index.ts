import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/contracts'

const bridge: DesktopBridge = {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  saveCheckIn: checkIn => ipcRenderer.invoke('checkin:save', checkIn),
  onState: callback => { const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void => callback(state); ipcRenderer.on('state:changed', listener); return () => ipcRenderer.removeListener('state:changed', listener) }
}
contextBridge.exposeInMainWorld('dAIly', bridge)
