const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const pkg = require(path.join(root, 'package.json'))

function status(label, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return Boolean(pass)
}

function parseNode(version) {
  const [major = 0, minor = 0, patch = 0] = String(version).split('.').map((value) => Number(value) || 0)
  return { major, minor, patch }
}

function supportedNode(version) {
  const { major, minor } = parseNode(version)
  return (major === 22 && minor >= 12) || major === 23 || major === 24
}

function electronBinaryPath() {
  const rootPath = path.join(root, 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return path.join(rootPath, 'electron.exe')
  if (process.platform === 'darwin') return path.join(rootPath, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(rootPath, 'electron')
}

let allPass = true
const check = (label, pass, detail = '') => { allPass = status(label, pass, detail) && allPass }
const nodeVersion = process.versions.node
check('Node.js version (>=22.12 <25)', supportedNode(nodeVersion), nodeVersion)
check('package.json identity', pkg.name === 'snapflow' && /^\d+\.\d+\.\d+$/.test(String(pkg.version)), `v${pkg.version}`)
check('Main package entry', pkg.main === './out/main/index.js', String(pkg.main || 'missing'))
check('Windows NSIS target', JSON.stringify(pkg.build?.win?.target || []).includes('nsis'))
check('Windows Portable target', JSON.stringify(pkg.build?.win?.target || []).includes('portable'))
check('NSIS assisted installer', pkg.build?.nsis?.oneClick === false && pkg.build?.nsis?.allowToChangeInstallationDirectory === true)
check('Electron package', fs.existsSync(path.join(root, 'node_modules', 'electron', 'package.json')))
const electronBinary = electronBinaryPath()
check('Electron binary', fs.existsSync(electronBinary), electronBinary)
check('Renderer entry', fs.existsSync(path.join(root, 'src', 'renderer', 'index.html')))
check('Main entry', fs.existsSync(path.join(root, 'src', 'main', 'index.ts')))
check('Preload entry', fs.existsSync(path.join(root, 'src', 'preload', 'index.ts')))
check('Login page', fs.existsSync(path.join(root, 'src', 'renderer', 'src', 'components', 'LoginPage.tsx')))
check('Windows build script', fs.existsSync(path.join(root, 'scripts', 'build-windows.ps1')))
check('Windows build launcher', fs.existsSync(path.join(root, 'BUILD_WINDOWS.cmd')))
check('Verified Electron Windows fallback', fs.existsSync(path.join(root, 'scripts', 'install-electron-windows.ps1')))
check('Provider setup guide', fs.existsSync(path.join(root, 'PROVIDER_SETUP.md')))
check('Packaged smoke test', fs.existsSync(path.join(root, 'scripts', 'smoke-windows.ps1')))
check('Application icon', fs.existsSync(path.join(root, 'build', 'icon.ico')))

if (!allPass) process.exitCode = 1
