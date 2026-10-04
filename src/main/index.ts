import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification, powerMonitor, dialog } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from './security'
import { Store } from './store'
import { CheckInSchema, ConfigSchema, Id } from '../shared/state'
import { OllamaClient } from './ollama'
import { Planner } from './planner'
import { MentorInput } from '../shared/planner'
import { SessionActionSchema } from '../shared/session'
import { Sessions } from './sessions'
import { arrivalDue, LocalNotifications } from './notifications'
import { resolve } from 'node:path'
import { smoke } from './smoke'
import { mkdirSync } from 'node:fs'
import { writeFile, rename, unlink } from 'node:fs/promises'
import { serializeExport } from './export'

let rendererUrl = ''
let store: Store
let sessions: Sessions
let tray: Tray
let quitting = false
const smokeDirectory = process.argv.find(arg => arg.startsWith('--smoke-test='))?.slice('--smoke-test='.length)
if (smokeDirectory) { app.disableHardwareAcceleration(); const path = resolve(smokeDirectory, 'user-data'); mkdirSync(path, { recursive: true }); app.setPath('userData', path) }
const ollama = new OllamaClient()
function publish(): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('state:changed', store.snapshot()) }

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    title: 'dAIly', autoHideMenuBar: true, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.once('ready-to-show', () => window.show())
  if (smokeDirectory) window.webContents.once('did-finish-load', () => { void smoke(window, store, resolve(smokeDirectory)) })
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide() } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  rendererUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname, '../renderer/index.html')).href
  void window.loadURL(rendererUrl)
}
function openWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) createWindow()
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
}
function updateTray(): void {
  const active = sessions.active()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open dAIly', click: openWindow },
    { label: active?.state === 'running' ? 'Pause session' : 'Resume session', enabled: !!active && !active.needsReconciliation && ['running', 'paused'].includes(active.state), click: () => { if (!active) return; try { sessions.act({ action: active.state === 'running' ? 'pause' : 'resume', id: active.id }); publish(); updateTray() } catch { openWindow() } } },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]))
}
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', openWindow)

app.whenReady().then(() => {
  store = new Store(join(app.getPath('userData'), 'daily.db'))
  sessions = new Sessions(store); sessions.recover()
  const planner = new Planner(store, ollama)
  const notices = new LocalNotifications(store, (title, body) => {
    if (!Notification.isSupported()) return false
    const notice = new Notification({ title, body }); notice.on('click', openWindow); notice.show(); return true
  })
  const applyLogin = (): void => { if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: store.snapshot().profile.launchAtLogin, args: ['--hidden'] }) }
  const handle = (channel: string, handler: (input: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) throw new Error('Untrusted renderer')
      return handler(input)
    })
  }
  handle('app:version', () => app.getVersion())
  handle('state:get', () => store.snapshot())
  handle('config:save', input => { const result = store.saveConfig(ConfigSchema.parse(input)); applyLogin(); publish(); return result })
  handle('checkin:save', input => { store.put('checkIns', CheckInSchema.parse(input)); publish(); return store.snapshot() })
  handle('model:status', () => ollama.status())
  handle('model:download', () => ollama.pull(progress => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('model:progress', progress) }))
  handle('model:cancel', () => ollama.cancel())
  handle('model:install', () => shell.openExternal('https://ollama.com/download/windows'))
  handle('mentor:ask', async input => { try { return await planner.request(MentorInput.parse(input).text) } finally { publish() } })
  handle('plan:accept', input => { const result = planner.accept(Id.parse(input)); publish(); return result })
  handle('session:action', input => { const result = sessions.act(SessionActionSchema.parse(input)); publish(); updateTray(); return result })
  handle('data:export', async () => {
    const selection = await dialog.showSaveDialog({ title: 'Export dAIly records', defaultPath: join(app.getPath('documents'), 'daily-records.json'), filters: [{ name: 'JSON records', extensions: ['json'] }] })
    if (selection.canceled || !selection.filePath) return { cancelled: true }
    const temporary = `${selection.filePath}.tmp-${process.pid}`
    try { await writeFile(temporary, serializeExport(store.snapshot(), app.getVersion()), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, selection.filePath) }
    finally { await unlink(temporary).catch(() => undefined) }
    return { cancelled: false, path: selection.filePath }
  })
  const image = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(image.resize({ width: 20, height: 20 })); tray.setToolTip('dAIly'); tray.on('double-click', openWindow); updateTray()
  applyLogin(); createWindow()
  if (process.argv.includes('--hidden')) BrowserWindow.getAllWindows()[0]?.once('ready-to-show', () => BrowserWindow.getAllWindows()[0]?.hide())
  powerMonitor.on('suspend', () => { sessions.suspend(); publish(); updateTray() })
  powerMonitor.on('resume', () => { publish(); updateTray() })
  const timer = setInterval(() => {
    const expired = sessions.tick()
    if (expired) { notices.deliver(`session:${expired.id}`, 'Focus block ended', 'What happened? Record your actual work in dAIly.'); publish(); updateTray() }
    const arrival = arrivalDue(store.snapshot(), Date.now())
    if (arrival) notices.deliver(arrival, 'How does your evening look?', 'Update your time and energy when you are ready.')
  }, 1000)
  app.once('before-quit', () => { quitting = true; clearInterval(timer); sessions.suspend(false); ollama.cancel() })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch(error => { dialog.showErrorBox('dAIly could not open', `Your records have not been deleted. ${String(error)}`); app.quit() })
app.on('will-quit', () => store?.close())
