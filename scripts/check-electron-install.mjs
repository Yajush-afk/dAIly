import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Do not import Electron: its lazy downloader would conceal a broken postinstall.
const require = createRequire(import.meta.url)
const directory = dirname(require.resolve('electron/package.json'))
const pathFile = join(directory, 'path.txt')
if (!existsSync(pathFile)) throw new Error('Electron installation is missing path.txt')
const executable = join(directory, 'dist', readFileSync(pathFile, 'utf8').trim())
if (!existsSync(executable)) throw new Error('Electron executable is missing')
if (process.platform === 'linux' && !existsSync(join(directory, 'dist', 'chrome-sandbox'))) {
  throw new Error('Electron sandbox helper is missing')
}
console.log('Electron executable is installed')
