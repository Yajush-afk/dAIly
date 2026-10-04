import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import electron from 'electron'

const binary = process.argv[2] || electron
const report = resolve(process.argv[3] || 'artifacts/desktop-smoke')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const args = process.argv[2] ? [] : ['.']
if (process.env.DAILY_LINUX_NO_SANDBOX === '1') args.push('--no-sandbox')
args.push(`--smoke-test=${report}`)
if (process.env.DAILY_SMOKE_WITH_MODEL === '1') args.push('--smoke-with-model')
const child = spawn(binary, args, { env, stdio: 'inherit' })
const timeout = setTimeout(() => { child.kill(); console.error('Desktop smoke timed out'); process.exitCode = 1 }, process.env.DAILY_SMOKE_WITH_MODEL === '1' ? 180000 : 60000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1 })
