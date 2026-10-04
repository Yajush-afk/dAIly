import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from './security'

let rendererUrl = ''

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
  ipcMain.handle('app:version', event => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) throw new Error('Untrusted renderer')
    return app.getVersion()
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
