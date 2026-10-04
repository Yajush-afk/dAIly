import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/contracts'

const bridge: DesktopBridge = {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  saveCheckIn: (checkIn) => ipcRenderer.invoke('checkin:save', checkIn),
  onState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ): void => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  modelStatus: () => ipcRenderer.invoke('model:status'),
  downloadModel: () => ipcRenderer.invoke('model:download'),
  cancelModel: () => ipcRenderer.invoke('model:cancel'),
  openOllamaDownload: () => ipcRenderer.invoke('model:install'),
  askMentor: (text, intent = 'plan') => ipcRenderer.invoke('mentor:ask', { text, intent }),
  acceptPlan: (id) => ipcRenderer.invoke('plan:accept', id),
  sessionAction: (command) => ipcRenderer.invoke('session:action', command),
  checkInAndPlan: (update) => ipcRenderer.invoke('day:checkin', update),
  recordOutcome: (command) => ipcRenderer.invoke('day:outcome', command),
  approveChanges: (review) => ipcRenderer.invoke('day:approve-changes', review),
  getHistory: (query) => ipcRenderer.invoke('history:get', query),
  exportData: () => ipcRenderer.invoke('data:export'),
  onDownload: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ): void => callback(progress)
    ipcRenderer.on('model:progress', listener)
    return () => ipcRenderer.removeListener('model:progress', listener)
  },
}
contextBridge.exposeInMainWorld('dAIly', bridge)
