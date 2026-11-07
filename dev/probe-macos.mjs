// Exercises the macOS-only decisions without an Apple machine: global npm
// roots, launch classification, Info.plist parsing, the app-bundle scan, the
// .command script, the installer architecture choice, PATH, and log paths.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  classifyLaunch,
  detectDesktopDarwin,
  desktopDownloadFor,
  globalModuleRoots,
  macShortcutScript,
  plistValue,
  restartLogPath,
  scanGlobal,
  toolPath,
} from '../index.js'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('ok  ', label)
  } else {
    failures += 1
    console.log('FAIL', label, detail === undefined ? '' : JSON.stringify(detail))
  }
}

// --- global module roots -------------------------------------------------
const darwinRoots = globalModuleRoots({
  platform: 'darwin',
  execPath: '/opt/homebrew/bin/node',
  env: {},
  homedir: '/Users/me',
  readdir: () => [],
})
check('homebrew prefix yields lib/node_modules', darwinRoots.includes('/opt/homebrew/lib/node_modules'), darwinRoots)
check('usr/local global root is present', darwinRoots.includes('/usr/local/lib/node_modules'), darwinRoots)
check('~/.npm-global root is present', darwinRoots.includes('/Users/me/.npm-global/lib/node_modules'), darwinRoots)

const nvmRoots = globalModuleRoots({
  platform: 'darwin',
  execPath: '/usr/bin/node',
  env: { NVM_DIR: '/Users/me/.nvm' },
  homedir: '/Users/me',
  readdir(base) {
    return base === '/Users/me/.nvm/versions/node' ? ['v22.1.0'] : []
  },
})
check('nvm version root is scanned', nvmRoots.includes('/Users/me/.nvm/versions/node/v22.1.0/lib/node_modules'), nvmRoots)

const winRoots = globalModuleRoots({
  platform: 'win32',
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
  homedir: 'C:\\Users\\me',
  readdir: () => [],
})
check(
  'Windows npm root is present',
  winRoots.some((root) => root.toLowerCase() === 'c:\\users\\me\\appdata\\roaming\\npm\\node_modules'),
  winRoots,
)
check(
  'Windows node prefix is present',
  winRoots.some((root) => root.toLowerCase() === 'c:\\program files\\nodejs\\node_modules'),
  winRoots,
)

// --- launch classification ----------------------------------------------
const macNpm = classifyLaunch(['/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'], {
  platform: 'darwin',
  roots: ['/opt/homebrew/lib/node_modules'],
})
check('macOS npm global is npm', macNpm?.kind === 'npm', macNpm)

const winNpm = classifyLaunch(['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'], {
  platform: 'win32',
  roots: ['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules'],
})
check('Windows npm global is npm', winNpm?.kind === 'npm', winNpm)

const npx = classifyLaunch(['/Users/me/.npm/_npx/0123456789abcdef/node_modules/@deepseek-ai/dsh/lib/bin.js'], {
  platform: 'darwin',
  roots: ['/usr/local/lib/node_modules'],
})
check('npx wins over node_modules', npx?.kind === 'npx' && npx.hash === '0123456789abcdef', npx)

const local = classifyLaunch(['C:\\work\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'], {
  platform: 'win32',
  roots: [],
})
check('a project-local install is not a global', local === null, local)

const desktop = classifyLaunch(['C:\\app\\dsh.exe'], { electron: true })
check('electron is desktop', desktop?.kind === 'desktop', desktop)

// --- Info.plist ----------------------------------------------------------
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>1.2.3</string>
<key>CFBundleExecutable</key><string>DeepSeek Harness</string>
<key>CFBundleName</key><string>DeepSeek &amp; Harness</string>
</dict></plist>`
check('plist reads a version', plistValue(plist, 'CFBundleShortVersionString') === '1.2.3', plistValue(plist, 'CFBundleShortVersionString'))
check('plist decodes XML entities', plistValue(plist, 'CFBundleName') === 'DeepSeek & Harness', plistValue(plist, 'CFBundleName'))

// --- app bundle scan -----------------------------------------------------
const home = await mkdtemp(path.join(os.tmpdir(), 'dshvm-macos-'))
try {
  const appDir = path.join(home, 'Applications')
  const app = path.join(appDir, 'DeepSeek Harness.app')
  await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(path.join(app, 'Contents', 'Info.plist'), plist)
  await writeFile(path.join(app, 'Contents', 'MacOS', 'DeepSeek Harness'), '')
  const detected = await detectDesktopDarwin({ appDirs: [appDir], runningBundle: null })
  check('app bundle version is detected', detected?.version === '1.2.3', detected)
  check('app bundle name is detected', detected?.name === 'DeepSeek Harness', detected)
  check(
    'app bundle executable is detected',
    detected?.executable === path.join(app, 'Contents', 'MacOS', 'DeepSeek Harness'),
    detected,
  )

  // --- scanGlobal against a temp root ------------------------------------
  const root = path.join(home, 'lib', 'node_modules')
  await mkdir(path.join(root, '@deepseek-ai', 'dsh'), { recursive: true })
  await writeFile(
    path.join(root, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-alpha.3' }),
  )
  const globals = await scanGlobal({ roots: [root] })
  check('scanGlobal reads a temp root', globals.length === 1 && globals[0].version === '0.2.2-alpha.3', globals)
} finally {
  await rm(home, { recursive: true, force: true })
}

// --- .command script -----------------------------------------------------
const script = macShortcutScript({
  node: '/opt/homebrew/bin/node',
  binPath: '/Users/me/.npm/_npx/abc/node_modules/@deepseek-ai/dsh/lib/bin.js',
  args: ['--profile', 'web', '--patch', 'a b.yml'],
  cwd: '/Users/me/my work',
})
check('script starts with a POSIX shebang', script.startsWith('#!/bin/sh\n'), script)
check('script quotes the working directory', script.includes("cd '/Users/me/my work' || exit 1"), script)
check(
  'script execs node and the CLI with every argument',
  script.includes(
    "exec '/opt/homebrew/bin/node' '/Users/me/.npm/_npx/abc/node_modules/@deepseek-ai/dsh/lib/bin.js' '--profile' 'web' '--patch' 'a b.yml'",
  ),
  script,
)
const quoted = macShortcutScript({ node: '/n', binPath: '/b', args: ["O'Brien"], cwd: '/tmp' })
check('single quotes are escaped', quoted.includes("'O'\\''Brien'"), quoted)

// --- installer architecture ---------------------------------------------
check('darwin arm64 gets the arm64 dmg', desktopDownloadFor({ platform: 'darwin', arch: 'arm64' })?.key === 'darwin-arm64')
check(
  'Rosetta x64 still gets the arm64 dmg',
  desktopDownloadFor({ platform: 'darwin', arch: 'x64', hardwareArm64: true })?.key === 'darwin-arm64',
)
check(
  'an Intel Mac gets the x64 dmg',
  desktopDownloadFor({ platform: 'darwin', arch: 'x64', hardwareArm64: false })?.key === 'darwin-x64',
)
check('Windows keeps the exe', desktopDownloadFor({ platform: 'win32', arch: 'x64' })?.key === 'win32-x64')

// --- PATH and log path ---------------------------------------------------
const macPath = toolPath({ PATH: '/usr/bin:/bin' }, { platform: 'darwin', execPath: '/opt/homebrew/bin/node', homedir: '/Users/me' })
check('PATH starts with the running node directory', macPath.startsWith('/opt/homebrew/bin:'), macPath)
check('PATH includes Homebrew and /usr/local binaries', macPath.includes('/opt/homebrew/bin') && macPath.includes('/usr/local/bin'), macPath)
check('PATH keeps the original entries', macPath.includes('/usr/bin') && macPath.includes('/bin'), macPath)

const winPath = toolPath(
  { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
  { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', homedir: 'C:\\Users\\me' },
)
check('Windows PATH is semicolon separated', winPath.includes(';'), winPath)
check(
  'Windows PATH includes node and npm',
  winPath.toLowerCase().includes('c:\\program files\\nodejs') &&
    winPath.toLowerCase().includes('c:\\users\\me\\appdata\\roaming\\npm') &&
    winPath.toLowerCase().includes('c:\\windows'),
  winPath,
)

check(
  'macOS log path is Library/Logs',
  restartLogPath({ platform: 'darwin', env: {}, homedir: '/Users/me' }) ===
    '/Users/me/Library/Logs/dsh-version-manager/restart.log',
  restartLogPath({ platform: 'darwin', env: {}, homedir: '/Users/me' }),
)
check(
  'DSH_HOME wins over the platform default',
  restartLogPath({ platform: 'darwin', env: { DSH_HOME: '/tmp/dsh' }, homedir: '/Users/me' }) ===
    '/tmp/dsh/logs/dsh-version-manager-restart.log',
)
check(
  'Windows log path is unchanged',
  restartLogPath({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, homedir: 'C:\\Users\\me' }) ===
    'C:\\Users\\me\\AppData\\Local\\dsh-version-manager\\restart.log',
)

if (failures > 0) {
  console.error(`\n${failures} macOS checks failed`)
  process.exit(1)
}
console.log('\nall macOS checks passed')