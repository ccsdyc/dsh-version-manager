/**
 * Probe for the Desktop shortcut plan:
 *
 * - a shortcut must carry the profile (a bare `dsh.cmd` exits with
 *   `error: --profile <name> is required`), and must drop `--no-open`;
 * - the preferred invoker is PowerShell with `-NoExit`, so a startup error
 *   stays readable; without PowerShell the launcher itself is the target.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shortcutIconPath, shortcutInvocation, shortcutLaunchArgs, shellIconRefreshScript } from '../index.js'

const failures = []
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(name)
}

const entry = 'C:\\x\\_npx\\f952829a1b7f9589\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'

const reused = shortcutLaunchArgs({ entry, tail: ['web', '--no-open', '--port', '3080'], profile: 'web', appArgs: [] })
check('reuses launcher args and drops --no-open', JSON.stringify(reused) === JSON.stringify(['web', '--port', '3080']), JSON.stringify(reused))

const fallback = shortcutLaunchArgs({ entry: 'C:\\node.exe', tail: [], profile: 'web', appArgs: ['--no-open', '--port', '3080'] })
check('falls back to --profile plus app args', JSON.stringify(fallback) === JSON.stringify(['--profile', 'web', '--port', '3080']), JSON.stringify(fallback))

const unknown = shortcutLaunchArgs({ entry: 'C:\\node.exe', tail: [], profile: null, appArgs: [] })
check('no profile yields no plan', unknown === null, String(unknown))

const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const decode = (text) => Buffer.from(text.split(' ').pop(), 'base64').toString('utf16le')
const ps = shortcutInvocation('C:\\a b\\dsh.cmd', ['web', '--port', '3080'], psPath)
check('PowerShell is the preferred target', ps.mode === 'powershell' && ps.target === psPath)
check('PowerShell arguments are encoded, not quoted', ps.arguments.startsWith('-NoProfile -NoExit -EncodedCommand '))
check(
  'PowerShell command carries the profile and arguments',
  decode(ps.arguments) === `& 'C:\\a b\\dsh.cmd' 'web' '--port' '3080'`,
  decode(ps.arguments),
)

const quoted = shortcutInvocation("C:\\O'Brien\\dsh.cmd", ['--profile', 'web'], psPath)
const quotedCommand = decode(quoted.arguments)
check('single quotes are doubled in the PowerShell literal', quotedCommand === `& 'C:\\O''Brien\\dsh.cmd' '--profile' 'web'`, quotedCommand)

const cmd = shortcutInvocation('C:\\a b\\dsh.cmd', ['--patch', 'C:\\a b.yml'], null)
check('command fallback targets the launcher', cmd.mode === 'command' && cmd.target === 'C:\\a b\\dsh.cmd')
check('command fallback quotes values with spaces', cmd.arguments === '--patch "C:\\a b.yml"', cmd.arguments)

const refresh = shellIconRefreshScript("C:\\O'Brien\\DeepSeek Harness.lnk")
check(
  'icon refresh notifies the shell about that shortcut',
  refresh.includes('SHChangeNotify(0x00002000, 0x0005') && refresh.includes("'C:\\O''Brien\\DeepSeek Harness.lnk'"),
  refresh,
)

const iconPath = fileURLToPath(new URL('../assets/tray.ico', import.meta.url))
check('the original tray icon ships with the package', existsSync(iconPath))
if (existsSync(iconPath)) {
  const ico = readFileSync(iconPath)
  const count = ico.readUInt16LE(4)
  const sizes = []
  let framesOk = count > 0
  for (let index = 0; index < count; index += 1) {
    const entryAt = 6 + index * 16
    const size = ico[entryAt] === 0 ? 256 : ico[entryAt]
    sizes.push(size)
    const frameAt = ico.readUInt32LE(entryAt + 12)
    const signature = ico.subarray(frameAt, frameAt + 4).toString('hex')
    if (size < 256 && signature !== '28000000') framesOk = false
    if (size === 256 && signature !== '28000000' && signature !== '89504e47') framesOk = false
  }
  check('tray.ico frames are BMP (the 256 frame may be PNG)', framesOk, sizes.join(','))
  check('tray.ico covers small and large sizes', sizes.includes(16) && sizes.includes(32) && sizes.includes(256), sizes.join(','))
}
check('the redundant dsh.ico is gone', !existsSync(fileURLToPath(new URL('../assets/dsh.ico', import.meta.url))))
const materialized = shortcutIconPath({ LOCALAPPDATA: 'C:\\Local' })
check(
  'the shortcut icon materializes outside the sandboxed workspace',
  materialized === 'C:\\Local\\dsh-version-manager\\shortcut.ico',
  materialized,
)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall shortcut checks passed')