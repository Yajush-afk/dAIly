import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const cli = resolve('node_modules/electron-vite/bin/electron-vite.js')
const child = spawn(process.execPath, [cli, 'dev'], { env, stdio: 'inherit' })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
