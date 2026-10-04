import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './store'
import { defaultProfile } from '../shared/state'
import type { WorkflowResult } from '../shared/workflow'

// Invoked only with an explicit test flag. The entry point redirects userData
// to an isolated directory before Electron opens any database.
export async function smoke(window: BrowserWindow, store: Store, directory: string): Promise<void> {
  const checks: string[] = []
  const assert = (value: unknown, message: string): void => {
    if (!value) throw new Error(message)
    checks.push(message)
  }
  const js = <T>(source: string): Promise<T> => window.webContents.executeJavaScript(source)
  try {
    mkdirSync(directory, { recursive: true })
    assert(
      await js(
        `typeof window.dAIly?.getState === 'function' && typeof window.require === 'undefined' && typeof window.process === 'undefined'`,
      ),
      'Renderer bridge exists without Node access',
    )
    const goalId = randomUUID(),
      taskId = randomUUID()
    const config = {
      profile: {
        ...defaultProfile,
        onboardingComplete: true,
        timezone: 'UTC',
        bedtime: '23:59',
        wakeTime: '00:00',
      },
      goals: [{ id: goalId, title: 'DSA', priority: 2, deadline: null }],
      tasks: [
        {
          id: taskId,
          goalId,
          title: 'Review one graph problem',
          estimateMinutes: 30,
          deadline: null,
          status: 'todo',
        },
      ],
      timetable: [],
    }
    await js(`window.dAIly.saveConfig(${JSON.stringify(config)})`)
    assert(store.snapshot().tasks[0].id === taskId, 'Typed renderer command persists into SQLite')
    const checkIn = {
      text: 'My available time has ended.',
      energy: 'okay',
      until: new Date().toISOString().slice(11, 16),
      busyStart: '',
      busyEnd: '',
    }
    const guarded = await js<WorkflowResult>(
      `window.dAIly.checkInAndPlan(${JSON.stringify(checkIn)})`,
    )
    assert(
      guarded.result?.origin === 'availability',
      'Application check-in workflow persists and respects exhausted availability',
    )
    await js(
      `window.dAIly.saveCheckIn(${JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), availableUntil: null, energy: 'okay', note: 'Time available for the test session.', busy: [] })})`,
    )
    // Leave a full test window even when CI starts close to midnight.
    config.profile.wakeTime = new Date().toISOString().slice(11, 16)
    config.profile.bedtime = new Date(Date.now() + 3 * 3600000).toISOString().slice(11, 16)
    await js(`window.dAIly.saveConfig(${JSON.stringify(config)})`)
    if (process.argv.includes('--smoke-with-model')) {
      assert(
        await js(`window.dAIly.modelStatus().then(status => status.ready)`),
        'Local Gemma is ready in the packaged app',
      )
      const workflow = await js<WorkflowResult>(
        `window.dAIly.checkInAndPlan(${JSON.stringify({ ...checkIn, until: config.profile.bedtime, text: 'Propose an achievable next block from my concrete tasks, unless you need one relevant question.' })})`,
      )
      const response = workflow.result
      assert(response, 'Check-in workflow returns a model decision')
      if (!response) throw new Error(workflow.planningError || 'Model decision missing')
      assert(
        response.decision.kind && response.durationMs > 0,
        'Real Gemma response crosses the packaged preload bridge',
      )
      writeFileSync(join(directory, 'gemma.json'), JSON.stringify(response, null, 2))
      if (response.planId) await js(`window.dAIly.acceptPlan('${response.planId}')`)
    }
    const now = Date.now(),
      blockId = randomUUID()
    store.put('plans', {
      id: randomUUID(),
      createdAt: new Date(now).toISOString(),
      contextRevision: store.revision,
      status: 'accepted',
      summary: 'A useful evening starts with one step.',
      blocks: [
        {
          id: blockId,
          taskId,
          kind: 'focus',
          title: 'Review one graph problem',
          start: new Date(now).toISOString(),
          end: new Date(now + 1800000).toISOString(),
          reason: 'You have thirty minutes available.',
        },
      ],
      deferred: [],
    })
    await js(`window.dAIly.sessionAction(${JSON.stringify({ action: 'start', blockId })})`)
    const id = store.snapshot().sessions.find((s) => s.blockId === blockId)!.id
    await js(`window.dAIly.sessionAction(${JSON.stringify({ action: 'pause', id })})`)
    await js(`window.dAIly.sessionAction(${JSON.stringify({ action: 'resume', id })})`)
    await js(`window.dAIly.sessionAction(${JSON.stringify({ action: 'finish', id })})`)
    assert(
      store.snapshot().tasks[0].status === 'todo',
      'Finishing a timer does not complete a task',
    )
    await js(
      `window.dAIly.saveCheckIn(${JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), availableUntil: new Date().toISOString(), energy: 'okay', note: 'Stop after this session.', busy: [] })})`,
    )
    const outcome = await js<WorkflowResult>(
      `window.dAIly.recordOutcome(${JSON.stringify({ action: 'outcome', id, outcome: 'completed', elapsedSeconds: 600, work: 'Reviewed the solution.', interruption: '' })})`,
    )
    assert(
      outcome.result?.origin === 'availability',
      'Application outcome workflow saves work and reconsiders availability',
    )
    assert(
      store.snapshot().tasks[0].status === 'done',
      'Explicit reported completion changes task status',
    )
    // React renders updates asynchronously. Poll for the actual visible UI.
    for (const page of ['Today', 'Goals', 'History', 'Settings']) {
      await js(
        `Array.from(document.querySelectorAll('nav button')).find(b => b.textContent === '${page}').click()`,
      )
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await js(`document.querySelector('h1')?.textContent === '${page}'`)) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert(
        await js(`document.querySelector('h1')?.textContent === '${page}'`),
        `${page} navigation renders`,
      )
      if (page === 'History') {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (await js(`document.body.textContent.includes('1 reported sessions')`)) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert(
          await js(`document.body.textContent.includes('1 reported sessions')`),
          'Paginated history loads through the desktop bridge',
        )
      }
      for (const [width, height] of [
        [1280, 800],
        [900, 650],
      ]) {
        window.setSize(width, height)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert(
          await js(`document.documentElement.scrollWidth <= innerWidth`),
          `${page} fits ${width} without horizontal overflow`,
        )
        // Windows virtual displays can briefly lose their capture surface after
        // a resize. Retry that specific compositor error, but still fail if a
        // usable screenshot cannot be captured.
        for (let attempt = 0; ; attempt++) {
          try {
            const screenshot = await window.webContents.capturePage()
            if (screenshot.isEmpty()) throw new Error('Empty desktop screenshot')
            writeFileSync(join(directory, `${page.toLowerCase()}-${width}.png`), screenshot.toPNG())
            break
          } catch (error) {
            if (!String(error).includes('UnknownVizError') || attempt >= 3) throw error
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
      }
    }
    window.close()
    assert(!window.isDestroyed() && !window.isVisible(), 'Closing the window hides it to the tray')
    writeFileSync(
      join(directory, 'smoke.json'),
      JSON.stringify({ passed: true, platform: process.platform, checks }, null, 2),
    )
    app.exit(0)
  } catch (error) {
    writeFileSync(
      join(directory, 'smoke.json'),
      JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
    )
    console.error(error)
    app.exit(1)
  }
}
