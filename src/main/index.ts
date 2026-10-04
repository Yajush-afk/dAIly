import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  dialog,
  nativeTheme,
} from 'electron'
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
import { writeFile, rename, unlink, readFile, stat } from 'node:fs/promises'
import { serializeExport } from './export'
import { DayApplication } from './application'
import { HistoryQuerySchema } from '../shared/history'
import type { Snapshot } from '../shared/state'
import { stateChanges } from './state-updates'
import { DayUpdateSchema, ReviewedChangesSchema } from '../shared/workflow'

let rendererUrl = ''
let store: Store
let sessions: Sessions
let tray: Tray
let quitting = false
if (process.argv.includes('--print-data-path')) {
  console.log(app.getPath('userData'))
  app.exit(0)
}
const smokeDirectory = process.argv
  .find((arg) => arg.startsWith('--smoke-test='))
  ?.slice('--smoke-test='.length)
if (smokeDirectory) {
  if (process.platform === 'win32') app.disableHardwareAcceleration()
  const path = resolve(smokeDirectory, 'user-data')
  mkdirSync(path, { recursive: true })
  app.setPath('userData', path)
}
const ollama = new OllamaClient()
let published: Snapshot | undefined
function publish(): void {
  const state = store.view()
  const update = stateChanges(published, state)
  published = state
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('state:changed', update)
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'dAIly',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  if (smokeDirectory)
    window.webContents.once('did-finish-load', () => {
      void smoke(window, store, resolve(smokeDirectory))
    })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  rendererUrl =
    process.env.ELECTRON_RENDERER_URL ||
    pathToFileURL(join(__dirname, '../renderer/index.html')).href
  void window.loadURL(rendererUrl)
}
function openWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) createWindow()
  else {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}
function updateTray(): void {
  const active = sessions.active()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open dAIly', click: openWindow },
      {
        label: active?.state === 'running' ? 'Pause session' : 'Resume session',
        enabled:
          !!active && !active.needsReconciliation && ['running', 'paused'].includes(active.state),
        click: () => {
          if (!active) return
          try {
            sessions.act({ action: active.state === 'running' ? 'pause' : 'resume', id: active.id })
            publish()
            updateTray()
          } catch {
            openWindow()
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', openWindow)

app
  .whenReady()
  .then(() => {
    store = new Store(join(app.getPath('userData'), 'daily.db'))
    sessions = new Sessions(store)
    sessions.recover()
    const planner = new Planner(store, ollama)
    const application = new DayApplication(store, planner, sessions, Date.now, () => {
      publish()
      updateTray()
    })
    const notices = new LocalNotifications(store, (title, body) => {
      if (!Notification.isSupported()) return false
      const notice = new Notification({ title, body })
      notice.on('click', openWindow)
      notice.show()
      return true
    })
    const applyLogin = (): void => {
      nativeTheme.themeSource = store.profile().theme
      if (process.platform === 'win32')
        app.setLoginItemSettings({ openAtLogin: store.profile().launchAtLogin, args: ['--hidden'] })
    }
    const handle = (channel: string, handler: (input: unknown) => unknown): void => {
      ipcMain.handle(channel, (event, input: unknown) => {
        if (
          !event.senderFrame ||
          event.senderFrame !== event.sender.mainFrame ||
          !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
        )
          throw new Error('Untrusted renderer')
        return handler(input)
      })
    }
    handle('app:version', () => app.getVersion())
    handle('state:get', () => {
      const state = store.view()
      published = state
      return state
    })
    handle('config:save', (input) => {
      const result = store.saveConfig(ConfigSchema.parse(input))
      applyLogin()
      publish()
      return result
    })
    handle('checkin:save', (input) => {
      store.put('checkIns', CheckInSchema.parse(input))
      publish()
      return store.view()
    })
    handle('model:status', () => ollama.status())
    handle('model:download', () =>
      ollama.pull((progress) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('model:progress', progress)
      }),
    )
    handle('model:cancel', () => ollama.cancel())
    handle('model:install', () => shell.openExternal('https://ollama.com/download/windows'))
    handle('mentor:ask', async (input) => {
      try {
        const request = MentorInput.parse(input)
        return await planner.request(request.text, request.intent, request.images)
      } finally {
        publish()
      }
    })
    handle('plan:accept', (input) => {
      const result = planner.accept(Id.parse(input))
      publish()
      return result
    })
    handle('session:action', (input) => {
      const result = sessions.act(SessionActionSchema.parse(input))
      publish()
      updateTray()
      return result
    })
    handle('dashboard:get', () => store.dashboardSummary())
    handle('history:get', (input) => store.history(HistoryQuerySchema.parse(input)))
    handle('day:checkin', (input) => application.checkInAndPlan(DayUpdateSchema.parse(input)))
    handle('day:approve-changes', (input) =>
      application.approveChanges(ReviewedChangesSchema.parse(input)),
    )
    handle('goal:discuss', (input) => application.discussGoal(input))
    handle('goal:approve-roadmap', (input) => application.approveRoadmap(input))
    handle('schedule:import', async () => {
      const picked = await dialog.showOpenDialog({
        title: 'Choose a college timetable',
        properties: ['openFile'],
        filters: [
          { name: 'Timetable files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'csv', 'xlsx'] },
        ],
      })
      if (picked.canceled || !picked.filePaths[0]) return undefined
      const filePath = picked.filePaths[0]
      if ((await stat(filePath)).size > 8_000_000)
        throw new Error('Choose a file smaller than 8 MB.')
      const data = await readFile(filePath)
      const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
      let images: string[] | undefined
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
        const image = nativeImage.createFromBuffer(data)
        if (image.isEmpty())
          throw new Error('dAIly could not read that image. Try a PNG or JPEG timetable.')
        const size = image.getSize()
        if (size.width > 7000 || size.height > 7000)
          throw new Error('Resize this image to under 7000 pixels per side and try again.')
        const prepared = image.resize({ width: 1400, quality: 'good' }).toJPEG(76)
        if (prepared.byteLength > 2_500_000)
          throw new Error('This timetable image is too large. Crop it or choose a smaller image.')
        images = [prepared.toString('base64')]
      }
      return application.importSchedule({ name: filePath, data, images })
    })
    handle('schedule:confirm', (input) => application.confirmSchedule(input))
    handle('day:outcome', (input) => {
      const command = SessionActionSchema.parse(input)
      if (command.action !== 'outcome') throw new Error('Expected a session outcome')
      return application.recordOutcome(command)
    })
    handle('data:export', async () => {
      const selection = await dialog.showSaveDialog({
        title: 'Export dAIly records',
        defaultPath: join(app.getPath('documents'), 'daily-records.json'),
        filters: [{ name: 'JSON records', extensions: ['json'] }],
      })
      if (selection.canceled || !selection.filePath) return { cancelled: true }
      const temporary = `${selection.filePath}.tmp-${process.pid}`
      try {
        await writeFile(temporary, serializeExport(store.snapshot(), app.getVersion()), {
          encoding: 'utf8',
          mode: 0o600,
        })
        await rename(temporary, selection.filePath)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      return { cancelled: false, path: selection.filePath }
    })
    const image = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    tray = new Tray(image.resize({ width: 20, height: 20 }))
    tray.setToolTip('dAIly')
    tray.on('double-click', openWindow)
    updateTray()
    applyLogin()
    createWindow()
    if (process.argv.includes('--hidden'))
      BrowserWindow.getAllWindows()[0]?.once('ready-to-show', () =>
        BrowserWindow.getAllWindows()[0]?.hide(),
      )
    powerMonitor.on('suspend', () => {
      sessions.suspend()
      publish()
      updateTray()
    })
    powerMonitor.on('resume', () => {
      publish()
      updateTray()
    })
    const timer = setInterval(() => {
      const expired = sessions.tick()
      if (expired) {
        notices.deliver(
          `session:${expired.id}`,
          'Focus block ended',
          'What happened? Record your actual work in dAIly.',
        )
        publish()
        updateTray()
      }
      const arrival = arrivalDue(store.runtimeState(), Date.now())
      if (arrival)
        notices.deliver(
          arrival,
          'How does your evening look?',
          'Update your time and energy when you are ready.',
        )
    }, 1000)
    app.once('before-quit', () => {
      quitting = true
      clearInterval(timer)
      sessions.suspend(false)
      ollama.cancel()
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    dialog.showErrorBox(
      'dAIly could not open',
      `Your records have not been deleted. ${String(error)}`,
    )
    app.quit()
  })
app.on('will-quit', () => store?.close())
