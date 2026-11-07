/**
 * Probe for the restart machinery, in three parts:
 *
 * 1. `versionAt` reads the version of the package that owns a dsh bin script.
 * 2. `restartPlan` keeps the launcher arguments, swaps only the bin script for
 *    the requested install, and adds `--no-open` when the target is the web app.
 * 3. `spawnRestartHelper` survives the old process, waits for its PID to leave,
 *    and starts the replacement command with its output appended to a log.
 *
 * Part 3 uses two throwaway HTTP servers on a scratch port, so it never touches
 * the running Harness.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installedLaunchTarget, restartPlan, spawnRestartHelper, versionAt } from '../index.js'

const failures = []
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(name)
}

/* 1. versionAt -------------------------------------------------------------- */
const npxRoots = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'npm-cache'),
].filter(Boolean)
let sampleBin = null
let sampleVersion = null
for (const root of npxRoots) {
  const { readdir } = await import('node:fs/promises')
  let hashes = []
  try {
    hashes = await readdir(path.join(root, '_npx'), { withFileTypes: true })
  } catch {
    continue
  }
  for (const entry of hashes) {
    if (!entry.isDirectory()) continue
    const bin = path.join(root, '_npx', entry.name, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const manifest = path.join(root, '_npx', entry.name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    try {
      sampleVersion = JSON.parse(await readFile(manifest, 'utf8')).version
      sampleBin = bin
      break
    } catch {
      /* keep looking */
    }
  }
  if (sampleBin !== null) break
}
check('versionAt reads an installed package version', sampleBin !== null && versionAt(sampleBin) === sampleVersion, `${sampleVersion}`)

/* 2. restartPlan ------------------------------------------------------------ */
const installed = await installedLaunchTarget('npx', sampleVersion)
check('installedLaunchTarget finds the installed npx copy', installed !== null && installed.binPath.endsWith('lib\\bin.js'), installed?.directory ?? '')

const launcherArgv = [
  'C:\\Program Files\\nodejs\\node.exe',
  'C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\bd325e168b7188a4\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
  'web',
  '--port',
  '3099',
]
const plan = await restartPlan(
  { target: 'npx', version: sampleVersion },
  { argv: launcherArgv, execPath: launcherArgv[0], pid: 4242, cwd: 'C:\\work', profile: 'web', appArgs: [] },
)
check('restartPlan keeps the launcher arguments', plan.ok === true && plan.args[0] === 'web' && plan.args[1] === '--port')
check('restartPlan appends --no-open for the web profile', plan.ok === true && plan.args.includes('--no-open'))
check('restartPlan swaps in the requested bin script', plan.ok === true && plan.binPath === installed?.binPath && plan.command[1] === installed?.binPath)
check('restartPlan rejects an unpublished version', (await restartPlan({ target: 'npx', version: '9.9.9' })).error === 'not-installed')
check('restartPlan rejects a shell metacharacter', (await restartPlan({ target: 'npx', version: '1.0.0 && whoami' })).error === 'invalid-version')

/* 3. helper: old server exits, new one takes the port ---------------------- */
const directory = await mkdtemp(path.join(tmpdir(), 'dsh-vm-restart-'))
const port = 34000 + Math.floor(Math.random() * 1000)
const log = path.join(directory, 'restart.log')
const pidFile = path.join(directory, 'new.pid')
const oldScript = path.join(directory, 'old.cjs')
const newScript = path.join(directory, 'new.cjs')
const serverSource = (body) => `
const http = require('node:http')
const fs = require('node:fs')
const server = http.createServer((request, response) => { response.end(${JSON.stringify(body)}) })
server.listen(Number(process.argv[2]), '127.0.0.1', () => {
  if (process.argv[3]) fs.writeFileSync(process.argv[3], String(process.pid))
})
`
await writeFile(oldScript, serverSource('old'))
await writeFile(newScript, serverSource('new'))

const { spawn } = await import('node:child_process')
const oldServer = spawn(process.execPath, [oldScript, String(port), ''], { stdio: 'ignore', windowsHide: true })
const waitForText = async (expected) => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if ((await response.text()) === expected) return true
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}
check('dummy old server is up', await waitForText('old'))
spawnRestartHelper({
  pid: oldServer.pid,
  cwd: directory,
  log,
  command: [process.execPath, newScript, String(port), pidFile],
})
// Simulate the graceful appExit the route performs after answering.
setTimeout(() => oldServer.kill(), 700)
check('helper replaces the server after the old PID exits', await waitForText('new'))
const text = await readFile(log, 'utf8').catch(() => '')
check('helper wrote its log', text.includes('waiting for pid') && text.includes('launch attempt'))

const newPid = Number((await readFile(pidFile, 'utf8').catch(() => '0')).trim())
if (Number.isInteger(newPid) && newPid > 0) {
  try {
    process.kill(newPid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}
try {
  oldServer.kill()
} catch {
  /* already gone */
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall restart checks passed')