const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function electronRoot() {
  try { return path.dirname(require.resolve('electron/package.json')) }
  catch { return '' }
}

function candidates(root) {
  if (!root) return []
  if (process.platform === 'win32') return [path.join(root, 'dist', 'electron.exe')]
  if (process.platform === 'darwin') return [path.join(root, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')]
  return [path.join(root, 'dist', 'electron')]
}

function binaryExists() {
  const root = electronRoot()
  return candidates(root).some((file) => fs.existsSync(file))
}

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...env }
  })
}

if (binaryExists()) {
  console.log('[SnapFlow] Electron binary is ready.')
  process.exit(0)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const installEnv = { ...process.env }
delete installEnv.ELECTRON_SKIP_BINARY_DOWNLOAD

console.log('[SnapFlow] Electron binary is missing.')
console.log('[SnapFlow] Attempt 1/3: Electron install-electron using the current download source...')
let result = run(npm, ['run', 'electron:install'], installEnv)
if (result.status === 0 && binaryExists()) {
  console.log('[SnapFlow] Electron binary installed successfully.')
  process.exit(0)
}

if (process.platform === 'win32') {
  console.log('[SnapFlow] Attempt 2/3: install-electron with the npmmirror Electron mirror...')
  const mirrorEnv = { ...installEnv, ELECTRON_MIRROR: installEnv.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' }
  result = run(npm, ['run', 'electron:install'], mirrorEnv)
  if (result.status === 0 && binaryExists()) {
    console.log('[SnapFlow] Electron binary installed successfully from mirror.')
    process.exit(0)
  }

  console.log('[SnapFlow] Attempt 3/3: verified direct ZIP download + Windows Expand-Archive fallback...')
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const script = path.join(process.cwd(), 'scripts', 'install-electron-windows.ps1')
  result = run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], mirrorEnv)
  if (result.status === 0 && binaryExists()) {
    console.log('[SnapFlow] Electron binary installed successfully with verified Windows fallback.')
    process.exit(0)
  }
}

console.error('\n[SnapFlow] Electron binary download did not complete.')
console.error('[SnapFlow] Application source code was not executed because the runtime is missing.')
console.error('[SnapFlow] Check firewall/proxy access to the configured Electron download source and retry: npm run electron:ensure')
process.exit(1)
