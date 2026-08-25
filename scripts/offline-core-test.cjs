const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
let ts
try { ts = require('typescript') }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js') }
const root = path.resolve(__dirname, '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'snapflow-core-'))
function emit(src, rel) {
  const source = fs.readFileSync(src, 'utf8')
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: src, reportDiagnostics: true })
  const diagnostics = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length) throw new Error(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, result.outputText)
}
for (const name of fs.readdirSync(path.join(root, 'src/shared'))) if (name.endsWith('.ts')) emit(path.join(root, 'src/shared', name), path.join('src/shared', name))
emit(path.join(root, 'src/main/credits.ts'), 'src/main/credits.ts')
for (const name of fs.readdirSync(path.join(root, 'tests'))) if (name.endsWith('.test.ts')) emit(path.join(root, 'tests', name), path.join('tests', name))
const tests = fs.readdirSync(path.join(out, 'tests')).filter(n => n.endsWith('.test.js')).map(n => path.join(out, 'tests', n))
const result = cp.spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' })
try { fs.rmSync(out, { recursive: true, force: true }) } catch {}
process.exit(result.status ?? 1)
