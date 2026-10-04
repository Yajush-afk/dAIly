import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
// Keep native SQLite's ABI correct for each runtime. npm ci installs it for Electron.
async function run(command, args, env = process.env) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32' && command === 'npm',
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}
try {
  await run('npm', ['rebuild', 'better-sqlite3'])
  await run(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    'scripts/seed-demo.mts',
    ...process.argv.slice(2).filter((argument) => argument !== '--seed-only'),
  ])
} finally {
  await run(process.execPath, [resolve('node_modules/electron-builder/cli.js'), 'install-app-deps'])
}
if (!process.argv.includes('--seed-only') && !process.argv.includes('--export'))
  await run('npm', ['run', 'dev'], { ...process.env, DAILY_DEMO_RECORDING: '1' })
