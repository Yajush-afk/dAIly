import { spawn } from 'node:child_process'
import electron from 'electron'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// This diagnostic exits before opening a renderer or database.
const args = ['.', '--print-data-path']
if (process.platform === 'linux') args.push('--no-sandbox')
const child = spawn(electron, args, { env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
