import { listPackage } from '@electron/asar'
import { resolve } from 'node:path'
const archive = resolve(process.argv[2] || 'release/win-unpacked/resources/app.asar')
const files = listPackage(archive).map((file) => file.replaceAll('\\', '/'))
const prohibited = files.filter(
  (file) =>
    /^\/(models|src|tests|scripts|artifacts|docs|\.git)(\/|$)/.test(file) ||
    /\.(db|sqlite|gguf|log)$/.test(file) ||
    /\/\.env(?:\.|$)/.test(file),
)
if (prohibited.length)
  throw new Error(`Personal or development files in package: ${prohibited.join(', ')}`)
if (!files.includes('/out/main/index.js') || !files.includes('/resources/icon.png'))
  throw new Error('Application entry point or tray icon missing')
console.log(
  `Checked ${files.length} archive entries. No models, personal data, or development sources included.`,
)
