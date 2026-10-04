import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from './security'
import { Store } from './store'
import { CheckInSchema, ConfigSchema } from '../shared/state'

let rendererUrl = ''
let store: Store
function publish(): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('state:changed', store.snapshot()) }

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    title: 'dAIly', autoHideMenuBar: true, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  rendererUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname, '../renderer/index.html')).href
  void window.loadURL(rendererUrl)
}

app.whenReady().then(() => {
  store = new Store(join(app.getPath('userData'), 'daily.db'))
  const handle = (channel: string, handler: (input: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) throw new Error('Untrusted renderer')
      return handler(input)
    })
  }
  handle('app:version', () => app.getVersion())
  handle('state:get', () => store.snapshot())
  handle('config:save', input => { const result = store.saveConfig(ConfigSchema.parse(input)); publish(); return result })
  handle('checkin:save', input => { store.put('checkIns', CheckInSchema.parse(input)); publish(); return store.snapshot() })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => store?.close())
