/**
 * Host half of the dsh version manager.
 *
 * Scans every npm cache root on this machine (`_npx` installs and the
 * `_cacache` content-addressable store), reports each dsh version found with
 * its footprint, and deletes old ones on request — including cache entries of
 * versions whose `_npx` directory the user already removed by hand.
 *
 * The browser half talks to the two routes registered here through same-origin
 * `fetch`; every route first passes the composition's connection trust fence.
 */
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory of this plugin, used for assets that travel with it. */
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))

/** Route: scan every cache root and return the version inventory. */
const ROUTE_LIST = '/dsh-versions/list'
/** Route: measure the on-disk size of known `_npx` install directories. */
const ROUTE_SIZES = '/dsh-versions/sizes'
/** Route: the newest rc/alpha versions published to the configured registry. */
const ROUTE_REGISTRY = '/dsh-versions/registry'
/** Route: install a newer npm (global) or npx version. */
const ROUTE_UPGRADE = '/dsh-versions/upgrade'
/** Route: restart the current DSH process on an already installed version. */
const ROUTE_RESTART = '/dsh-versions/restart'
/** Route: delete one or more versions (install directories and/or cache entries). */
const ROUTE_DELETE = '/dsh-versions/delete'
/** Route: inspect the installed desktop client and its download target. */
const ROUTE_DESKTOP = '/dsh-versions/desktop'
/** Route: download the desktop installer into a chosen folder and launch it. */
const ROUTE_DESKTOP_INSTALL = '/dsh-versions/desktop/install'
/** Route: put a double-click launcher for the current install on the Desktop. */
const ROUTE_SHORTCUT = '/dsh-versions/shortcut'
/** Route: the Chinese tip QR image shipped in `assets/dashang.jpg`. */
const ROUTE_TIP_QRCODE = '/dsh-versions/tip-qrcode'
/** File name (without extension) of the launcher this plugin owns on the Desktop. */
const SHORTCUT_NAME = 'DeepSeek Harness'
/** Original shortcut icon shipped with this plugin; override with `DSH_VERSION_MANAGER_ICON`. */
const SHORTCUT_ICON = process.env.DSH_VERSION_MANAGER_ICON ?? path.join(PLUGIN_ROOT, 'assets', 'tray.ico')
/** Fixed official installer URLs; the file name carries no version. */
const DESKTOP_DOWNLOADS = {
  'win32-x64': 'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe',
  'darwin-arm64': 'https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg',
  'darwin-x64': 'https://download.deepseek.com/desktop/dsh-latest-macos-x64.dmg',
}
/** Only these hosts may serve an installer. */
const DESKTOP_HOSTS = new Set(['download.deepseek.com'])
/** App bundle names that belong to the desktop client on macOS. */
const DESKTOP_APP_NAME = /deepseek|(^|\s)dsh(\s|$)|harness/i
/** Upper bound for one installer download. */
const DESKTOP_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
/** Request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024
/** Registry tarball keys of any `@deepseek-ai/dsh` package, with its version. */
const TARBALL_KEY =
  /@deepseek-ai\/(dsh(?:-[^/]+)?)\/-\/[^/]+-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?)\.tgz(?:[?#].*)?$/
/** The CLI package whose local installs and cache entries this plugin manages. */
const DSH = '@deepseek-ai/dsh'
/** In-flight `readdir`/`stat` calls while measuring a tree (the stat syscall dominates). */
const WALK_CONCURRENCY = 32

/**
 * Version of the dsh package this process loaded, read from the package that
 * owns the script in `process.argv[1]`. Captured at module load on purpose: an
 * in-place upgrade of the npm global copy replaces package.json below a running
 * process, so a later read would claim the new version while the old code is
 * still in memory.
 */
export function versionAt(entry) {
  if (typeof entry !== 'string' || entry === '') return null
  const marker = `${path.sep}@deepseek-ai${path.sep}dsh${path.sep}`
  const index = entry.lastIndexOf(marker)
  if (index === -1) return null
  try {
    const manifest = JSON.parse(readFileSync(path.join(entry.slice(0, index + marker.length - 1), 'package.json'), 'utf8'))
    return typeof manifest?.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/** How this process was launched, and the dsh version it actually loaded. */
const BOOT_LAUNCH = currentLaunch()
const BOOT_VERSION = versionAt(process.argv[1])

/**
 * What the panel should call "running": the install kind and version this
 * process booted from, not the newest copy on disk.
 */
export function runtimeInfo(ctx) {
  const exit = ctx?.appExit ?? ctx?.get?.('appExit')
  return {
    kind: BOOT_LAUNCH?.kind ?? null,
    hash: BOOT_LAUNCH?.hash ?? null,
    version: BOOT_VERSION,
    pid: process.pid,
    canRestart: typeof exit === 'function' && process.versions?.electron === undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The user's home directory, or an empty string when the platform cannot name it. */
function safeHomedir() {
  try {
    return os.homedir()
  } catch {
    return ''
  }
}

/**
 * Directories that may hold a globally installed node package. Windows keeps
 * global packages below `%APPDATA%\npm\node_modules`; POSIX prefixes put them
 * below `<prefix>/lib/node_modules`, and the version managers keep one such
 * prefix per node release.
 *
 * Exported for the macOS probe: the returned candidates are intentionally not
 * filtered by existence here, so tests can assert the platform rules alone.
 */
export function globalModuleRoots(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const execPath = options.execPath ?? process.execPath
  const home = options.homedir ?? safeHomedir()
  const readdir = options.readdir ?? readdirSync
  const p = platform === 'win32' ? path.win32 : path.posix
  const roots = []
  const add = (value) => {
    if (typeof value !== 'string' || value === '') return
    roots.push(p.resolve(value))
  }
  const addVersioned = (base, tail) => {
    let names
    try {
      names = readdir(base)
    } catch {
      return
    }
    for (const name of names) add(p.join(base, String(name), ...tail))
  }

  if (platform === 'win32') {
    if (env.APPDATA) add(p.join(env.APPDATA, 'npm', 'node_modules'))
    if (env.LOCALAPPDATA) add(p.join(env.LOCALAPPDATA, 'npm', 'node_modules'))
    if (env.NPM_CONFIG_PREFIX) add(p.join(env.NPM_CONFIG_PREFIX, 'node_modules'))
    if (execPath) add(p.join(p.dirname(execPath), 'node_modules'))
  } else {
    const bin = p.dirname(execPath)
    if (p.basename(bin) === 'bin') add(p.join(p.dirname(bin), 'lib', 'node_modules'))
    for (const prefix of [env.NPM_CONFIG_PREFIX, env.PREFIX]) {
      if (prefix) add(p.join(prefix, 'lib', 'node_modules'))
    }
    add('/usr/local/lib/node_modules')
    if (platform === 'darwin') add('/opt/homebrew/lib/node_modules')
    if (home !== '') {
      add(p.join(home, '.npm-global', 'lib', 'node_modules'))
      add(p.join(home, '.local', 'lib', 'node_modules'))
    }
    const nvmDirs = []
    if (env.NVM_DIR) nvmDirs.push(env.NVM_DIR)
    if (home !== '') nvmDirs.push(p.join(home, '.nvm'))
    for (const nvm of nvmDirs) addVersioned(p.join(nvm, 'versions', 'node'), ['lib', 'node_modules'])
    if (home !== '') {
      addVersioned(p.join(home, '.nodebrew', 'node'), ['lib', 'node_modules'])
      addVersioned(p.join(home, '.volta', 'tools', 'image', 'node'), ['lib', 'node_modules'])
      addVersioned(p.join(home, '.asdf', 'installs', 'nodejs'), ['lib', 'node_modules'])
    }
    if (platform === 'darwin' && home !== '') {
      addVersioned(p.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), ['installation', 'lib', 'node_modules'])
    }
  }

  const seen = new Set()
  const unique = []
  for (const root of roots) {
    const key = platform === 'win32' ? root.toLowerCase() : root
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(root)
  }
  return unique
}

/** Resolve every directory that may hold npx installs or the npm cache. */
function npmCacheRoots() {
  const candidates = []
  if (process.env.npm_config_cache) candidates.push(process.env.npm_config_cache)
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'npm-cache'))
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm-cache'))
  try {
    candidates.push(path.join(os.homedir(), '.npm'))
  } catch {
    /* no home directory: ignore the candidate */
  }
  const roots = []
  for (const candidate of candidates) {
    if (!candidate) continue
    let resolved
    try {
      resolved = path.resolve(candidate)
    } catch {
      continue
    }
    if (roots.includes(resolved)) continue
    try {
      if (!existsSync(resolved)) continue
    } catch {
      continue
    }
    roots.push(resolved)
  }
  return roots
}

/** Whether a candidate directory actually carries npx installs or a cache. */
function isCacheRoot(root) {
  return existsSync(path.join(root, '_npx')) || existsSync(path.join(root, '_cacache'))
}

/** Map `items` through `worker` with at most `limit` concurrent calls. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/** Total byte size of a directory tree; symlinks are counted as zero. */
async function directorySize(root) {
  let bytes = 0
  let active = 0
  const queue = [root]
  await new Promise((resolve) => {
    const pump = () => {
      while (active < WALK_CONCURRENCY && queue.length > 0) {
        const directory = queue.pop()
        active += 1
        void (async () => {
          try {
            const entries = await readdir(directory, { withFileTypes: true })
            for (const entry of entries) {
              const absolute = path.join(directory, entry.name)
              if (entry.isDirectory()) {
                queue.push(absolute)
              } else if (entry.isFile()) {
                const info = await stat(absolute).catch(() => null)
                if (info !== null) bytes += info.size
              }
            }
          } catch {
            /* unreadable directory: nothing to add */
          }
          active -= 1
          if (active === 0 && queue.length === 0) resolve()
          else pump()
        })()
      }
    }
    pump()
  })
  return bytes
}

/** Cached tree sizes keyed by directory, invalidated when its own mtime moves. */
const sizeCache = new Map()

/** Directory size with a small process-lifetime cache (stat is the slow part). */
async function measuredSize(directory, mtimeMs) {
  const cached = sizeCache.get(directory)
  if (cached !== undefined && cached.mtime === mtimeMs) return cached.bytes
  const bytes = await directorySize(directory)
  if (sizeCache.size > 64) sizeCache.clear()
  sizeCache.set(directory, { mtime: mtimeMs, bytes })
  return bytes
}

/** Yield every regular file below `root`. */
async function* walkFiles(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) yield* walkFiles(absolute)
    else if (entry.isFile()) yield absolute
  }
}

/** Read and parse a JSON file, or null when it is missing or malformed. */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** Parse the version out of an npx manifest's `_npx.packages` (or its dependency spec). */
function versionFromManifest(manifest) {
  const packages = Array.isArray(manifest?._npx?.packages) ? manifest._npx.packages : []
  for (const spec of packages) {
    if (typeof spec !== 'string') continue
    const match = /^@deepseek-ai\/dsh@(.+)$/.exec(spec.trim())
    if (match) return match[1].trim()
  }
  const dependency = manifest?.dependencies?.[DSH]
  if (typeof dependency === 'string') {
    const cleaned = dependency.replace(/^[\^~>=v\s]+/, '').split(/\s+/)[0]
    if (/^\d/.test(cleaned)) return cleaned
  }
  return null
}

/** Parse one `_cacache/index-v5` line into its stored entry, or null. */
function parseIndexLine(line) {
  const tab = line.indexOf('\t')
  if (tab === -1) return null
  try {
    const entry = JSON.parse(line.slice(tab + 1))
    return entry !== null && typeof entry === 'object' ? entry : null
  } catch {
    return null
  }
}

/** Match a cache key against `@deepseek-ai/dsh*/-/<name>-<version>.tgz`. */
function tarballOfKey(key) {
  if (typeof key !== 'string') return null
  let text = key
  if (text.includes('%2f') || text.includes('%2F')) text = text.replace(/%2f/gi, '/')
  const match = TARBALL_KEY.exec(text)
  if (!match) return null
  return { name: match[1], version: match[2] }
}

/** Semver ordering for the versions npm produces (`1.2.3`, `1.2.3-rc.1`). */
function compareVersions(left, right) {
  const parse = (value) => {
    const trimmed = String(value ?? '').trim().replace(/^v/, '')
    const plus = trimmed.indexOf('+')
    const core = plus === -1 ? trimmed : trimmed.slice(0, plus)
    const dash = core.indexOf('-')
    const main = dash === -1 ? core : core.slice(0, dash)
    const pre = dash === -1 ? [] : core.slice(dash + 1).split('.')
    return { main: main.split('.').map((part) => Number.parseInt(part, 10) || 0), pre }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.main[index] ?? 0) - (b.main[index] ?? 0)
    if (delta !== 0) return delta
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  const length = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < length; index += 1) {
    const x = a.pre[index]
    const y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta
    } else if (xNumeric) return -1
    else if (yNumeric) return 1
    else {
      const delta = x < y ? -1 : x > y ? 1 : 0
      if (delta !== 0) return delta
    }
  }
  return 0
}

/** The highest version in a list, or null when the list is empty. */
function newestOf(versions) {
  let newest = null
  for (const version of versions) {
    if (typeof version !== 'string') continue
    if (newest === null || compareVersions(version, newest) > 0) newest = version
  }
  return newest
}

/**
 * Hash names of the `_npx` directories the current process runs from.
 * Used to keep the live installation from being deleted out from under itself.
 */
function runningHashes() {
  const hashes = new Set()
  const texts = []
  for (const argument of process.argv) texts.push(String(argument ?? ''))
  try {
    texts.push(process.cwd())
  } catch {
    /* no working directory: ignore */
  }
  for (const name of ['PWD', 'INIT_CWD', 'npm_config_cache', 'npm_execpath']) {
    const value = process.env[name]
    if (value) texts.push(String(value))
  }
  for (const text of texts) {
    const match = /_npx[\\/]([0-9a-f]{8,})/i.exec(text)
    if (match) hashes.add(match[1].toLowerCase())
  }
  return hashes
}

/* -------------------------------------------------------------------------- */
/* scanning                                                                   */
/* -------------------------------------------------------------------------- */

/** Read every dsh install below `<root>/_npx`. */
async function scanNpx(root, measure) {
  const npxRoot = path.join(root, '_npx')
  let entries
  try {
    entries = await readdir(npxRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(npxRoot, entry.name)
    let version = versionFromManifest(await readJson(path.join(directory, 'package.json')))
    if (version === null) {
      const installed = await readJson(path.join(directory, 'node_modules', DSH, 'package.json'))
      if (typeof installed?.version === 'string') version = installed.version
    }
    if (version === null) continue
    const info = await stat(directory).catch(() => null)
    found.push({
      version,
      directory,
      hash: entry.name,
      bytes: 0,
      mtime: info === null ? 0 : info.mtimeMs,
      cacheRoot: root,
    })
  }
  if (measure) {
    await Promise.all(found.map(async (install) => {
      install.bytes = await measuredSize(install.directory, install.mtime).catch(() => 0)
    }))
  }
  return found
}

/** Aggregate the dsh tarballs held by `<root>/_cacache` per dsh version. */
async function scanCacache(root) {
  const indexRoot = path.join(root, '_cacache', 'index-v5')
  const versions = new Map()
  if (!existsSync(indexRoot)) return { versions, entries: 0 }

  const files = []
  for await (const file of walkFiles(indexRoot)) files.push(file)
  const contents = await mapLimit(files, 32, async (file) => {
    try {
      return await readFile(file, 'utf8')
    } catch {
      return ''
    }
  })

  let entries = 0
  for (const text of contents) {
    for (const line of text.split('\n')) {
      if (!line) continue
      const entry = parseIndexLine(line)
      if (entry === null) continue
      entries += 1
      const hit = tarballOfKey(entry.key)
      if (hit === null) continue
      let aggregate = versions.get(hit.version)
      if (aggregate === undefined) {
        aggregate = { version: hit.version, bytes: 0, entries: 0, packages: new Set(), digests: new Set(), root }
        versions.set(hit.version, aggregate)
      }
      aggregate.entries += 1
      aggregate.packages.add(hit.name)
      const digest = typeof entry.integrity === 'string' ? entry.integrity : `key:${entry.key}`
      if (!aggregate.digests.has(digest)) {
        aggregate.digests.add(digest)
        aggregate.bytes += Number(entry.size) || 0
      }
    }
  }
  return { versions, entries }
}

/**
 * Read globally installed `@deepseek-ai/dsh` packages (reported, never deleted).
 * @param options.roots - node_modules directories; defaults to this platform's.
 */
export async function scanGlobal(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots.map(String) : globalModuleRoots()
  const found = []
  const seen = new Set()
  for (const root of roots) {
    let directory
    try {
      directory = path.resolve(path.join(root, DSH))
    } catch {
      continue
    }
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory
    if (seen.has(key) || !existsSync(directory)) continue
    seen.add(key)
    const manifest = await readJson(path.join(directory, 'package.json'))
    if (typeof manifest?.version !== 'string') continue
    found.push({ version: manifest.version, directory })
  }
  return found
}

/**
 * Build the full inventory: one row per dsh version found in any npm cache
 * root, merged with its `_npx` installs and its cached tarballs.
 * @param options.measure - compute directory sizes (skipped for delete guards).
 */
export async function scanAll(options = {}) {
  const measure = options.measure !== false
  const roots = npmCacheRoots().filter(isCacheRoot)
  const installs = []
  const cacheByVersion = new Map()
  const rootSummaries = []

  const scanned = await Promise.all(
    roots.map(async (root) => {
      const [npxInstalls, cache] = await Promise.all([scanNpx(root, measure), scanCacache(root)])
      return { root, npxInstalls, cache }
    }),
  )

  for (const { root, npxInstalls, cache } of scanned) {
    installs.push(...npxInstalls)
    for (const aggregate of cache.versions.values()) {
      const merged = cacheByVersion.get(aggregate.version)
      if (merged === undefined) {
        cacheByVersion.set(aggregate.version, {
          version: aggregate.version,
          bytes: aggregate.bytes,
          entries: aggregate.entries,
          packages: [...aggregate.packages],
          roots: [root],
        })
      } else {
        merged.bytes += aggregate.bytes
        merged.entries += aggregate.entries
        merged.roots = [...new Set([...merged.roots, root])]
        merged.packages = [...new Set([...merged.packages, ...aggregate.packages])]
      }
    }
    rootSummaries.push({
      root,
      npxInstalls: npxInstalls.length,
      cacheVersions: cache.versions.size,
      cacheEntries: cache.entries,
    })
  }

  const running = runningHashes()
  const rows = new Map()
  for (const install of installs) {
    let row = rows.get(install.version)
    if (row === undefined) {
      row = { version: install.version, installs: [], cache: null, latest: false, running: false }
      rows.set(install.version, row)
    }
    row.installs.push(install)
  }
  for (const cache of cacheByVersion.values()) {
    let row = rows.get(cache.version)
    if (row === undefined) {
      row = { version: cache.version, installs: [], cache: null, latest: false, running: false }
      rows.set(cache.version, row)
    }
    row.cache = cache
  }

  const list = [...rows.values()].sort((left, right) => compareVersions(right.version, left.version))
  for (const row of list) {
    const installBytes = row.installs.reduce((total, install) => total + install.bytes, 0)
    const cacheBytes = row.cache?.bytes ?? 0
    row.bytes = installBytes + cacheBytes
    row.installBytes = installBytes
    row.cacheBytes = cacheBytes
    row.installed = row.installs.length > 0
    row.measured = measure
    row.running = row.installs.some((install) => running.has(install.hash.toLowerCase()))
    row.paths = row.installs.map((install) => install.directory)
    row.lastUsed = row.installs.reduce((latest, install) => Math.max(latest, install.mtime), 0)
    row.packages = row.cache?.packages ?? [DSH]
  }
  const installed = list.filter((row) => row.installed)
  if (installed.length > 0) installed[0].latest = true

  const globals = (await scanGlobal()).map((entry) => ({ ...entry, global: true }))
  const deletable = list.filter((row) => !row.latest && !row.running)
  return {
    ok: true,
    measured: measure,
    generatedAt: Date.now(),
    platform: process.platform,
    cacheRoots: rootSummaries,
    rows: list,
    globals,
    totals: {
      versions: list.length,
      installed: installed.length,
      cacheOnly: list.filter((row) => !row.installed).length,
      reclaimableBytes: deletable.reduce((total, row) => total + row.bytes, 0),
      cacheBytes: list.reduce((total, row) => total + row.cacheBytes, 0),
      installBytes: list.reduce((total, row) => total + row.installBytes, 0),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* registry: newest rc and alpha                                              */
/* -------------------------------------------------------------------------- */

/** How long one registry answer is reused before a fresh lookup. */
const REGISTRY_TTL_MS = 5 * 60 * 1000
/** Upper bound for one registry request. */
const REGISTRY_TIMEOUT_MS = 15000
/** Upper bound for one npm/npx install. */
const UPGRADE_TIMEOUT_MS = 15 * 60 * 1000
/** rc and alpha prerelease markers (`0.2.1-rc.5`, `0.2.2-alpha.2`). */
const RC_VERSION = /-rc(?:[.-]|$)/i
const ALPHA_VERSION = /-alpha(?:[.-]|$)/i
/** One accepted version string; everything else never reaches a shell. */
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?$/

/** The registry npm would use: env, then the user's `.npmrc`, then the public default. */
async function resolveRegistry() {
  const fromEnv = process.env.npm_config_registry
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  let config = ''
  try {
    config = await readFile(path.join(os.homedir(), '.npmrc'), 'utf8')
  } catch {
    config = ''
  }
  const scoped = /^@deepseek-ai:registry=(.+)$/m.exec(config)
  if (scoped !== null) return scoped[1].trim()
  const plain = /^registry=(.+)$/m.exec(config)
  if (plain !== null) return plain[1].trim()
  return 'https://registry.npmjs.org/'
}

/** Cached registry answer for the panel. */
let registryCache = null

/**
 * Read the package's versions from the configured registry and pick the
 * newest rc and alpha. Failures are never cached, so a retry can recover.
 */
async function fetchRegistry(options = {}) {
  const force = options.force === true
  if (!force && registryCache !== null && Date.now() - registryCache.at < REGISTRY_TTL_MS) {
    return registryCache.value
  }
  let registry = 'https://registry.npmjs.org/'
  try {
    registry = await resolveRegistry()
  } catch {
    /* keep the public default */
  }
  const base = registry.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/@deepseek-ai%2fdsh`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    const versions = Object.keys(body?.versions ?? {})
    const tags = body?.['dist-tags'] ?? {}
    const newestOf = (pattern) => versions.filter((version) => pattern.test(version)).sort(compareVersions).at(-1) ?? null
    const value = {
      ok: true,
      registry: base,
      fetchedAt: Date.now(),
      versions,
      tags,
      rc: newestOf(RC_VERSION),
      alpha: newestOf(ALPHA_VERSION),
    }
    registryCache = { at: Date.now(), value }
    return value
  } catch (error) {
    return {
      ok: false,
      registry: base,
      fetchedAt: null,
      versions: [],
      tags: {},
      rc: null,
      alpha: null,
      error: String(error?.message ?? error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The wire shape of a registry answer (the full version list stays on the Host). */
function registryPayload(value) {
  return {
    ok: value.ok,
    registry: value.registry,
    fetchedAt: value.fetchedAt,
    rc: value.rc,
    alpha: value.alpha,
    tags: value.tags,
    error: value.error,
  }
}

/** Test/inspection seam: the registry answer the panel would receive. */
export async function registrySnapshot(force = true) {
  return registryPayload(await fetchRegistry({ force }))
}

/* -------------------------------------------------------------------------- */
/* upgrade                                                                    */
/* -------------------------------------------------------------------------- */

/** The one upgrade running right now, if any. */
let upgrading = null

/**
 * PATH for a spawned tool, with the running node's directory and the usual npm
 * install locations first. A desktop app launched from Finder on macOS does not
 * inherit the login shell's PATH, so `npm` installed by Homebrew or nvm is
 * otherwise invisible to an upgrade.
 */
export function toolPath(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const home = options.homedir ?? safeHomedir()
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  const current = typeof env.PATH === 'string' && env.PATH !== ''
    ? env.PATH
    : typeof env.Path === 'string'
      ? env.Path
      : ''
  const extras = []
  if (execPath) extras.push(p.dirname(execPath))
  if (platform === 'win32') {
    if (env.APPDATA) extras.push(p.join(env.APPDATA, 'npm'))
  } else {
    extras.push('/opt/homebrew/bin', '/usr/local/bin')
    if (home !== '') extras.push(p.join(home, '.npm-global', 'bin'), p.join(home, '.local', 'bin'))
    const nvmDirs = []
    if (env.NVM_DIR) nvmDirs.push(env.NVM_DIR)
    if (home !== '') nvmDirs.push(p.join(home, '.nvm'))
    for (const nvm of nvmDirs) {
      let names
      try {
        names = readdirSync(p.join(nvm, 'versions', 'node'))
      } catch {
        names = []
      }
      for (const name of names) extras.push(p.join(nvm, 'versions', 'node', String(name), 'bin'))
    }
    if (home !== '') {
      extras.push(p.join(home, '.volta', 'bin'))
      extras.push(p.join(home, '.asdf', 'shims'))
      extras.push(p.join(home, '.nodebrew', 'current', 'bin'))
      extras.push(p.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'))
    }
  }
  const seen = new Set()
  const parts = []
  for (const value of [...extras, ...current.split(separator)]) {
    if (typeof value !== 'string' || value === '') continue
    const key = platform === 'win32'
      ? value.replace(/[\\/]+$/, '').toLowerCase()
      : value.replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(value)
  }
  return parts.join(separator)
}

/**
 * Run one shell command, keeping a bounded tail of its output.
 * @returns the exit code, the tail, and whether the timeout fired.
 */
function runCommand(command, timeoutMs, env = process.env) {
  return new Promise((resolve) => {
    let child
    try {
      // Windows treats `Path` and `PATH` as one variable; keep a single key.
      const childEnv = { ...env }
      for (const key of Object.keys(childEnv)) {
        if (key.toLowerCase() === 'path') delete childEnv[key]
      }
      childEnv.PATH = toolPath(env)
      child = spawn(command, { shell: true, windowsHide: true, env: childEnv })
    } catch (error) {
      resolve({ code: -1, output: String(error?.message ?? error), timedOut: false })
      return
    }
    let output = ''
    let timedOut = false
    const append = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-20000)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: `${output}\n${String(error?.message ?? error)}`.trim(), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output, timedOut })
    })
  })
}

/**
 * Install a newer version for one area: `npm install -g` for the global npm
 * copy, `npx --yes ... --version` to populate the npx cache. The version must
 * exist in the registry, so the shell only ever sees a validated token.
 */
export async function upgradeVersion(request = {}) {
  const target = request.target === 'npm' ? 'npm' : request.target === 'npx' ? 'npx' : null
  if (target === null) return { ok: false, error: 'invalid-target', output: '' }
  const version = request.version
  if (typeof version !== 'string' || !SAFE_VERSION.test(version)) return { ok: false, error: 'invalid-version', output: '' }
  if (upgrading !== null) return { ok: false, error: 'busy', output: '' }

  const registry = await fetchRegistry()
  if (!registry.ok) return { ok: false, error: 'registry-unavailable', detail: registry.error, output: '' }
  if (!registry.versions.includes(version)) return { ok: false, error: 'unknown-version', output: '' }

  const spec = `${DSH}@${version}`
  const command = target === 'npm' ? `npm install --global ${spec}` : `npx --yes ${spec} --version`
  const startedAt = Date.now()
  upgrading = { target, version, startedAt }
  try {
    const result = await runCommand(command, UPGRADE_TIMEOUT_MS)
    return {
      ok: result.code === 0 && !result.timedOut,
      target,
      version,
      command,
      code: result.code,
      timedOut: result.timedOut,
      durationMs: Date.now() - startedAt,
      output: result.output,
      error: result.timedOut ? 'timeout' : result.code === 0 ? undefined : `exit-${result.code}`,
    }
  } finally {
    upgrading = null
    registryCache = null
  }
}

/* -------------------------------------------------------------------------- */
/* restart                                                                    */
/* -------------------------------------------------------------------------- */

/** The one restart started by this process, so a second request cannot race it. */
let restarting = null
/** How long the detached helper waits for this process to exit before terminating it. */
const RESTART_GRACE_MS = 20000
/** How long a freshly launched server must stay up before the helper accepts it. */
const RESTART_PROBE_MS = 3000
/** Launch attempts when the new server exits early (typically the port is not free yet). */
const RESTART_ATTEMPTS = 4

/**
 * Detached helper source: wait for this process to release the port, then start
 * the new install with the original command line. It runs outside this process
 * on purpose — the old server must be gone before the new one can bind.
 *
 * Arguments (after `-e`): old pid, cwd, log path, grace ms, probe ms, exe, argv...
 * Kept as plain CommonJS with string concatenation so nothing is interpolated.
 */
const RESTART_HELPER = `
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const args = process.argv.slice(1)
const oldPid = Number(args[0])
const cwd = args[1]
const log = args[2]
const graceMs = Number(args[3])
const probeMs = Number(args[4])
const command = args.slice(5)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const alive = () => { try { process.kill(oldPid, 0); return true } catch { return false } }
const note = (text) => { try { fs.appendFileSync(log, '[' + new Date().toISOString() + '] ' + text + '\\n') } catch {} }
async function main() {
  note('restart helper: waiting for pid ' + oldPid + ' to exit')
  const deadline = Date.now() + graceMs
  while (alive() && Date.now() < deadline) await sleep(200)
  if (alive()) {
    note('restart helper: pid ' + oldPid + ' is still alive; terminating it')
    try { process.kill(oldPid, 'SIGKILL') } catch {}
    for (let attempt = 0; attempt < 50 && alive(); attempt += 1) await sleep(200)
  }
  await sleep(1000)
  let out = 'ignore'
  try { out = fs.openSync(log, 'a') } catch {}
  for (let attempt = 1; attempt <= ${RESTART_ATTEMPTS}; attempt += 1) {
    note('restart helper: launch attempt ' + attempt + ': ' + command.join(' '))
    let child
    try {
      child = spawn(command[0], command.slice(1), {
        cwd,
        env: process.env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', out, out],
      })
    } catch (error) {
      note('restart helper: spawn failed: ' + String(error && error.message || error))
      await sleep(1500)
      continue
    }
    const outcome = await new Promise((resolve) => {
      let settled = false
      const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value) } }
      const timer = setTimeout(() => finish('running'), probeMs)
      child.once('error', (error) => finish('error: ' + String(error && error.message || error)))
      child.once('exit', (code) => finish('exit ' + code))
    })
    child.unref()
    if (outcome === 'running' || outcome === 'exit 0') { note('restart helper: ' + outcome); break }
    note('restart helper: ' + outcome)
    await sleep(1500)
  }
  if (out !== 'ignore') { try { fs.closeSync(out) } catch {} }
  process.exit(0)
}
main().catch((error) => { note('restart helper: fatal ' + String(error && error.message || error)); process.exit(1) })
`

/** Where the helper appends its own and the new server's output. */
export function restartLogPath(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.homedir ?? safeHomedir()
  const p = platform === 'win32' ? path.win32 : path.posix
  const dshHome = env.DSH_HOME
  if (typeof dshHome === 'string' && dshHome !== '') {
    return p.join(dshHome, 'logs', 'dsh-version-manager-restart.log')
  }
  if (platform === 'darwin') {
    return p.join(home, 'Library', 'Logs', 'dsh-version-manager', 'restart.log')
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA ?? p.join(home, 'AppData', 'Local')
    return p.join(base, 'dsh-version-manager', 'restart.log')
  }
  return p.join(home, '.local', 'state', 'dsh-version-manager', 'restart.log')
}

/** Start the detached helper; the returned child is already unreferenced. */
export function spawnRestartHelper({ pid, cwd, log, command }) {
  // Tool-shell markers describe the old process's callers, not a fresh server.
  const env = { ...process.env }
  delete env.DSH_SESSION_ID
  delete env.DSH_SHELL
  delete env.DSH_WEB_URL
  const child = spawn(
    process.execPath,
    ['-e', RESTART_HELPER, String(pid), cwd, log, String(RESTART_GRACE_MS), String(RESTART_PROBE_MS), ...command],
    { detached: true, stdio: 'ignore', windowsHide: true, env },
  )
  child.unref()
  return child
}

/** The install a restart on `version` would launch, or null when it is not installed. */
export async function installedLaunchTarget(target, version) {
  if (target === 'npx') {
    const candidates = []
    for (const root of npmCacheRoots().filter(isCacheRoot)) {
      for (const install of await scanNpx(root, false)) {
        if (install.version !== version) continue
        const binPath = path.join(install.directory, 'node_modules', DSH, 'lib', 'bin.js')
        if (existsSync(binPath)) candidates.push({ binPath, directory: install.directory, mtime: install.mtime })
      }
    }
    candidates.sort((left, right) => right.mtime - left.mtime)
    return candidates[0] ?? null
  }
  if (target === 'npm') {
    for (const global of await scanGlobal()) {
      if (global.version !== version) continue
      const binPath = path.join(global.directory, 'lib', 'bin.js')
      if (existsSync(binPath)) return { binPath, directory: global.directory, mtime: 0 }
    }
  }
  return null
}

/** Whether this argument list boots the browser profile (which reopens a tab by default). */
function selectsWebProfile(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === 'web') return true
    if (args[index] === '--profile' && args[index + 1] === 'web') return true
  }
  return false
}

/**
 * Build the command that starts `version` with this process's own launcher
 * arguments. The dsh script in argv[1] is replaced with the new install's
 * script; every other argument (profile, patches, app flags) is preserved.
 */
export async function restartPlan(request = {}, host = {}) {
  const target = request.target === 'npm' ? 'npm' : request.target === 'npx' ? 'npx' : null
  if (target === null) return { ok: false, error: 'invalid-target' }
  const version = request.version
  if (typeof version !== 'string' || !SAFE_VERSION.test(version)) return { ok: false, error: 'invalid-version' }
  if (host.electron === true) return { ok: false, error: 'unsupported-host' }

  const install = await installedLaunchTarget(target, version)
  if (install === null) return { ok: false, error: 'not-installed', target, version }

  const argv = Array.isArray(host.argv) ? host.argv.map(String) : process.argv.slice()
  const entry = argv[1] ?? ''
  const profile = typeof host.profile === 'string' && host.profile !== '' ? host.profile : null
  const appArgs = Array.isArray(host.appArgs) ? host.appArgs.map(String) : []

  let args
  if (/[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/i.test(entry)) {
    args = argv.slice(2)
  } else if (profile !== null) {
    args = ['--profile', profile, ...appArgs]
  } else {
    return { ok: false, error: 'unsupported-command' }
  }
  // The restart comes from an open page, so the new server must not open a tab.
  if (selectsWebProfile(args) && !args.includes('--no-open')) args = [...args, '--no-open']

  return {
    ok: true,
    target,
    version,
    installDirectory: install.directory,
    binPath: install.binPath,
    args,
    command: [host.execPath ?? process.execPath, install.binPath, ...args],
    pid: Number.isSafeInteger(host.pid) ? host.pid : process.pid,
    cwd: typeof host.cwd === 'string' ? host.cwd : process.cwd(),
  }
}

/**
 * Restart the current process on an installed version: start the detached
 * helper, then hand back the exit request the route calls after it answers.
 * @returns the public restart facts plus the composition's bounded exit.
 */
export async function restartVersion(ctx, request = {}) {
  if (restarting !== null) return { ok: false, error: 'busy' }
  const exit = ctx?.appExit ?? ctx?.get?.('appExit')
  if (typeof exit !== 'function') return { ok: false, error: 'unsupported-host' }
  const plan = await restartPlan(request, {
    argv: process.argv,
    execPath: process.execPath,
    pid: process.pid,
    cwd: process.cwd(),
    profile: ctx?.get?.('profileContext')?.name ?? process.env.DSH_PROFILE ?? null,
    appArgs: typeof ctx?.cmdlineArgs?.get === 'function' ? ctx.cmdlineArgs.get() : [],
    electron: process.versions?.electron !== undefined,
  })
  if (!plan.ok) return plan

  const log = restartLogPath()
  try {
    await mkdir(path.dirname(log), { recursive: true })
    const info = await stat(log).catch(() => null)
    if (info !== null && info.size > 2 * 1024 * 1024) await writeFile(log, '')
  } catch {
    return { ok: false, error: 'log-unavailable' }
  }

  restarting = { target: plan.target, version: plan.version, log }
  try {
    spawnRestartHelper({ pid: plan.pid, cwd: plan.cwd, log, command: plan.command })
  } catch (error) {
    restarting = null
    return { ok: false, error: 'spawn-failed', detail: String(error?.message ?? error) }
  }
  return {
    ok: true,
    target: plan.target,
    version: plan.version,
    pid: plan.pid,
    log,
    exit,
  }
}

/* -------------------------------------------------------------------------- */
/* desktop client                                                             */
/* -------------------------------------------------------------------------- */

/** Cached hardware answer for Rosetta; macOS ships an ARM64 installer today. */
let appleSiliconCache
function isAppleSilicon() {
  if (appleSiliconCache !== undefined) return appleSiliconCache
  appleSiliconCache = false
  if (process.platform === 'darwin') {
    try {
      const value = execFileSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8', timeout: 2000 })
      appleSiliconCache = value.trim() === '1'
    } catch {
      appleSiliconCache = process.arch === 'arm64'
    }
  }
  return appleSiliconCache
}

/**
 * Installer URL for one platform/architecture. An x64 node under Rosetta still
 * runs on ARM64 hardware, so the architectural answer follows the machine, not
 * the process; Intel Macs use the published x64 disk image.
 */
export function desktopDownloadFor(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const effective = platform === 'darwin' && arch === 'x64' && options.hardwareArm64 === true ? 'arm64' : arch
  const key = `${platform}-${effective}`
  const url = DESKTOP_DOWNLOADS[key]
  return typeof url === 'string' ? { key, url, file: url.slice(url.lastIndexOf('/') + 1) } : null
}

/** Installer URL for this machine, or null when unsupported here. */
function desktopDownload() {
  return desktopDownloadFor({
    platform: process.platform,
    arch: process.arch,
    hardwareArm64: process.platform === 'darwin' ? isAppleSilicon() : undefined,
  })
}

/** Parse `reg query ... /s` output into one record per uninstall entry. */
function parseUninstallEntries(text) {
  const entries = []
  for (const block of String(text ?? '').split(/\r?\n\r?\n/)) {
    const field = (name) => {
      const match = new RegExp(`^\\s*${name}\\s+REG_[A-Z_]+\\s+(.+)$`, 'm').exec(block)
      return match === null ? null : match[1].trim()
    }
    const displayName = field('DisplayName')
    if (displayName === null || !/deepseek|(^|\s)dsh(\s|$)|harness/i.test(displayName)) continue
    entries.push({
      name: displayName,
      version: field('DisplayVersion'),
      location: field('InstallLocation'),
    })
  }
  return entries
}

/** A POSIX shell single-quoted literal (`'` becomes `'\''`). */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** Decode the XML entities an Info.plist string value may carry. */
function decodeXmlText(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Read one string value from an XML plist document. Exported for the probe. */
export function plistValue(text, key) {
  const pattern = new RegExp(`<key>\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</key>\\s*<string>([^<]*)</string>`)
  const match = pattern.exec(String(text ?? ''))
  if (match === null) return null
  const value = decodeXmlText(match[1]).trim()
  return value === '' ? null : value
}

/** Read one Info.plist field; a binary plist is decoded through `plutil`. */
async function plistField(plistPath, key) {
  const text = await readFile(plistPath, 'utf8').catch(() => null)
  if (text === null) return null
  const value = plistValue(text, key)
  if (value !== null) return value
  if (!text.startsWith('bplist') || process.platform !== 'darwin') return null
  const result = await runCommand(`/usr/bin/plutil -extract ${key} raw -o - ${shellQuote(plistPath)}`, 5000)
  if (result.code !== 0) return null
  const extracted = result.output.trim()
  return extracted === '' ? null : extracted
}

/** The `.app` bundle containing this Electron process, when there is one. */
export function runningAppBundle(execPath = process.execPath) {
  let current = path.dirname(execPath)
  for (let depth = 0; depth < 8; depth += 1) {
    if (/\.app$/i.test(current)) {
      return existsSync(path.join(current, 'Contents', 'Info.plist')) ? current : null
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** First regular file of a directory, when it has one. */
async function firstFile(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const entry = entries.find((item) => item.isFile())
  return entry === undefined ? null : path.join(directory, entry.name)
}

/**
 * The desktop client installed on this macOS machine, read from the app
 * bundles in `/Applications` and `~/Applications`. A bundle the running
 * Electron process came from is considered too, but marked transient when it
 * sits outside those folders (for example a copy launched from a mounted DMG).
 * @param options.appDirs - directories to scan; defaults to the two above.
 * @param options.runningBundle - bundle path override; null disables it.
 */
export async function detectDesktopDarwin(options = {}) {
  const home = options.homedir ?? safeHomedir()
  const appDirs = Array.isArray(options.appDirs)
    ? options.appDirs.map(String)
    : ['/Applications', ...(home === '' ? [] : [path.join(home, 'Applications')])]
  const running = options.runningBundle === undefined ? runningAppBundle() : options.runningBundle
  const standard = new Set(appDirs.map((directory) => path.resolve(directory)))
  const apps = []
  const seen = new Set()
  const consider = async (appPath, transient) => {
    const resolved = path.resolve(appPath)
    if (seen.has(resolved)) return
    seen.add(resolved)
    const info = await stat(resolved).catch(() => null)
    if (info === null || !info.isDirectory()) return
    const plist = path.join(resolved, 'Contents', 'Info.plist')
    const shortVersion = await plistField(plist, 'CFBundleShortVersionString')
    const version = shortVersion ?? await plistField(plist, 'CFBundleVersion')
    const executableName = await plistField(plist, 'CFBundleExecutable')
    const executable = executableName !== null
      ? path.join(resolved, 'Contents', 'MacOS', executableName)
      : await firstFile(path.join(resolved, 'Contents', 'MacOS'))
    apps.push({
      name: path.basename(resolved).replace(/\.app$/i, ''),
      version,
      location: resolved,
      executable,
      transient: transient === true,
    })
  }
  for (const directory of appDirs) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !/\.app$/i.test(entry.name)) continue
      if (!DESKTOP_APP_NAME.test(entry.name)) continue
      await consider(path.join(directory, entry.name), false)
    }
  }
  if (typeof running === 'string' && running !== '' && existsSync(running)) {
    const parent = path.dirname(path.resolve(running))
    await consider(running, !standard.has(parent))
  }
  if (apps.length === 0) return null
  apps.sort((left, right) =>
    Number(left.transient === true) - Number(right.transient === true) ||
    compareVersions(right.version ?? '0', left.version ?? '0'))
  return apps[0]
}

/** The desktop client installed on this Windows machine, when one is registered. */
async function detectDesktopWindows() {
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  const found = []
  for (const key of keys) {
    const result = await runCommand(`reg query "${key}" /s`, 15000)
    if (result.code !== 0 || result.output.length === 0) continue
    found.push(...parseUninstallEntries(result.output))
  }
  if (found.length === 0) return null
  return found.sort((left, right) => compareVersions(right.version ?? '0', left.version ?? '0'))[0]
}

/**
 * Parse the filename from a Content-Disposition header, including RFC 5987
 * `filename*` values. The desktop installer URL is versionless, but its
 * disposition carries the published build's file name.
 */
export function installerFileNameFromDisposition(value) {
  if (typeof value !== 'string') return null
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value)
  if (encoded !== null) {
    const raw = encoded[1].trim().replace(/^"|"$/g, '')
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value)
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim()
  return name === '' ? null : name
}

/** Extract the DSH version from an installer filename such as `...-0.2.2-rc.1-win-x64.exe`. */
export function installerVersionFromFileName(fileName) {
  if (typeof fileName !== 'string') return null
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(fileName)
  if (match === null) return null
  return match[1].replace(/-(?:win|mac|darwin|linux|arm64|x64|x86|universal)(?:[.-].*)?$/i, '')
}

/**
 * What the panel shows for the desktop area: the installed client (if any),
 * this platform's installer URL, and the download's size, release date, and
 * published version parsed from the Content-Disposition file name.
 */
export async function desktopSnapshot() {
  const download = desktopDownload()
  const installed = process.platform === 'win32'
    ? await detectDesktopWindows().catch(() => null)
    : process.platform === 'darwin'
      ? await detectDesktopDarwin().catch(() => null)
      : null
  let size = 0
  let modified = null
  let publishedFileName = null
  let publishedVersion = null
  let reachable = false
  if (download !== null) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(download.url, { method: 'HEAD', signal: controller.signal })
      reachable = response.ok
      size = Number(response.headers.get('content-length') ?? 0) || 0
      modified = response.headers.get('last-modified')
      // Read for every platform: if an artifact that used to omit this header
      // (currently the Intel x64 DMG) starts returning it, the next check picks
      // up the version without a code change.
      publishedFileName = installerFileNameFromDisposition(response.headers.get('content-disposition'))
      publishedVersion = installerVersionFromFileName(publishedFileName)
    } catch {
      reachable = false
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    ok: true,
    platform: `${process.platform}-${process.arch}`,
    supported: download !== null,
    url: download?.url ?? null,
    fileName: download?.file ?? null,
    reachable,
    size,
    modified,
    publishedFileName,
    publishedVersion,
    installed,
  }
}

/**
 * Download the installer into `directory` and launch it. The user picks the
 * folder in the browser; the Host only accepts an absolute, existing directory.
 * @returns the saved file, its size, and whether the installer was started.
 */
export async function installDesktop(request = {}) {
  const directory = request.directory
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return { ok: false, error: 'invalid-directory' }
  const download = desktopDownload()
  if (download === null) return { ok: false, error: 'unsupported-platform' }
  let host
  try {
    host = new URL(download.url).hostname
  } catch {
    return { ok: false, error: 'invalid-url' }
  }
  if (!DESKTOP_HOSTS.has(host)) return { ok: false, error: 'untrusted-host' }
  const info = await stat(directory).catch(() => null)
  if (info === null || !info.isDirectory()) return { ok: false, error: 'missing-directory' }

  const target = path.join(directory, download.file)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DESKTOP_DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(download.url, { signal: controller.signal })
    if (!response.ok || response.body === null) return { ok: false, error: `HTTP ${response.status}` }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  } catch (error) {
    await rm(target, { force: true }).catch(() => {})
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }

  let size = 0
  try {
    size = (await stat(target)).size
  } catch {
    size = 0
  }
  if (size === 0) {
    await rm(target, { force: true }).catch(() => {})
    return { ok: false, error: 'empty-download' }
  }

  let launched = false
  try {
    const child = process.platform === 'darwin'
      ? spawn('/usr/bin/open', [target], { detached: true, stdio: 'ignore' })
      : spawn(target, [], { detached: true, stdio: 'ignore' })
    child.unref()
    launched = true
  } catch (error) {
    return { ok: false, file: target, size, error: String(error?.message ?? error) }
  }
  return { ok: true, file: target, size, launched }
}

/* -------------------------------------------------------------------------- */
/* desktop launcher                                                           */
/* -------------------------------------------------------------------------- */

/** The user's Desktop folder, independent of the current working directory. */
function desktopDirectory() {
  return path.join(safeHomedir(), 'Desktop')
}

/** The newest executable inside an installed desktop client's folder. */
async function desktopExecutable(location) {
  if (typeof location !== 'string' || location.length === 0) return null
  const entries = await readdir(location).catch(() => [])
  const executables = entries.filter((name) => /\.exe$/i.test(name))
  if (executables.length === 0) return null
  const preferred = executables.find((name) => /dsh|deepseek|harness/i.test(name))
  return path.join(location, preferred ?? executables[0])
}

/** Whether a path sits below one of the global module roots. */
function textUnderRoot(text, root, platform) {
  const clean = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '')
  const fold = platform === 'win32' ? (value) => value.toLowerCase() : (value) => value
  const value = fold(clean(text))
  const base = fold(clean(root))
  return value === base || value.startsWith(`${base}/`)
}

/**
 * Classify how a process was started from its command line and environment.
 * The npx cache always wins: an npx install also lives below `node_modules`,
 * and only its `_npx/<hash>` component tells the two apart.
 */
export function classifyLaunch(evidence, options = {}) {
  if (options.electron === true) return { kind: 'desktop' }
  const texts = (Array.isArray(evidence) ? evidence : [evidence]).filter((value) => typeof value === 'string')
  const joined = texts.join('\n')
  const npx = /_npx[\\/]([0-9a-f]{8,})/i.exec(joined)
  if (npx !== null) return { kind: 'npx', hash: npx[1].toLowerCase() }
  const platform = options.platform ?? process.platform
  const roots = options.roots ?? globalModuleRoots({ platform })
  if (texts.some((text) => roots.some((root) => textUnderRoot(text, root, platform)))) return { kind: 'npm' }
  // A prefix the root list cannot predict (for example a custom POSIX prefix)
  // still names a global install through `lib/node_modules`; Windows keeps the
  // `npm` or nvm component above `node_modules`.
  if (texts.some((text) => /[\\/]lib[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh(?:[\\/]|$)/i.test(text))) return { kind: 'npm' }
  if (texts.some((text) => /[\\/](?:npm|nvm[\\/][^\\/]+)[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh(?:[\\/]|$)/i.test(text))) return { kind: 'npm' }
  return null
}

/**
 * How this very process was started. The shortcut follows the running install
 * instead of assuming a desktop build wins: a machine may have the exe installed
 * while the session itself came from npx.
 */
function currentLaunch() {
  const evidence = [
    process.argv[1],
    process.argv[0],
    process.cwd(),
    process.env.PWD,
    process.env.INIT_CWD,
    process.env.npm_execpath,
  ].filter((value) => typeof value === 'string')
  return classifyLaunch(evidence, { electron: process.versions?.electron !== undefined })
}

/** The Windows PowerShell this machine ships, or null when it is absent. */
function windowsPowerShell() {
  const root = process.env.SystemRoot ?? process.env.windir
  if (typeof root !== 'string' || root === '') return null
  const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : null
}

/** A PowerShell single-quoted literal (`'` is doubled). */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** The directory a double-clicked shortcut should open the new session in. */
function shortcutWorkingDirectory() {
  try {
    const directory = process.cwd()
    if (existsSync(directory)) return directory
  } catch {
    /* fall through to home */
  }
  return os.homedir()
}

/**
 * Arguments a Desktop shortcut hands to the CLI: this process's own launcher
 * arguments (`web`, `--profile`, patches, app flags), minus `--no-open` — a
 * double-click is supposed to open the GUI. Null when no profile is known.
 */
export function shortcutLaunchArgs({ entry, tail, profile, appArgs }) {
  let args
  if (typeof entry === 'string' && /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/i.test(entry)) {
    args = Array.isArray(tail) ? tail.map(String) : []
  } else if (typeof profile === 'string' && profile !== '') {
    args = ['--profile', profile, ...(Array.isArray(appArgs) ? appArgs.map(String) : [])]
  } else {
    return null
  }
  return args.filter((argument) => argument !== '--no-open')
}

/**
 * How a shortcut starts the CLI. PowerShell is preferred because `-NoExit`
 * keeps the console open when startup fails; without it the launcher itself is
 * the target and Windows runs the `.cmd` through cmd.exe.
 */
export function shortcutInvocation(launcher, args, powershell = windowsPowerShell()) {
  const values = Array.isArray(args) ? args.map(String) : []
  if (powershell !== null) {
    // Base64/UTF-16 keeps the launcher path and arguments out of the command
    // line's quote rules entirely; `-NoExit` keeps a startup error readable.
    const command = `& ${psQuote(launcher)}${values.map((value) => ` ${psQuote(value)}`).join('')}`
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    return {
      target: powershell,
      arguments: `-NoProfile -NoExit -EncodedCommand ${encoded}`,
      mode: 'powershell',
      launcher,
    }
  }
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return {
    target: launcher,
    arguments: values.map(quote).join(' '),
    mode: 'command',
    launcher,
  }
}

/**
 * Which command the Desktop shortcut should start. The current launch method
 * comes first; the remaining kinds are fallbacks so the button still works when
 * the running install cannot be reached.
 */
async function shortcutTarget(ctx) {
  const launch = currentLaunch()
  const args = shortcutLaunchArgs({
    entry: process.argv[1],
    tail: process.argv.slice(2),
    profile: ctx?.get?.('profileContext')?.name ?? process.env.DSH_PROFILE ?? null,
    appArgs: typeof ctx?.cmdlineArgs?.get === 'function' ? ctx.cmdlineArgs.get() : [],
  })
  const workingDirectory = shortcutWorkingDirectory()
  const inventory = await scanAll({ measure: false }).catch(() => null)

  const candidates = process.platform === 'darwin'
    ? await darwinShortcutCandidates({ launch, args, inventory, workingDirectory })
    : await windowsShortcutCandidates({ launch, args, inventory, workingDirectory })
  const order = launch === null
    ? ['desktop', 'npm', 'npx']
    : [launch.kind, ...['desktop', 'npm', 'npx'].filter((kind) => kind !== launch.kind)]
  for (const kind of order) {
    if (candidates[kind] !== null && candidates[kind] !== undefined) return candidates[kind]
  }
  return null
}

/** The Windows shortcut plan: `.lnk` targets, the npm `.cmd`, and npx `.cmd` files. */
async function windowsShortcutCandidates({ launch, args, inventory, workingDirectory }) {
  const installed = await detectDesktopWindows().catch(() => null)
  const executable = await desktopExecutable(installed?.location)
  const desktopCandidate = executable === null
    ? null
    : {
        kind: 'desktop',
        target: executable,
        arguments: '',
        mode: 'direct',
        launcher: executable,
        version: installed?.version ?? null,
        workingDirectory: path.dirname(executable),
      }

  const globalLauncher = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'dsh.cmd')
  const npmCandidate =
    inventory !== null && args !== null && (inventory.globals ?? []).length > 0 && existsSync(globalLauncher)
      ? {
          kind: 'npm',
          ...shortcutInvocation(globalLauncher, args),
          version: newestOf((inventory.globals ?? []).map((entry) => entry.version)),
          workingDirectory,
        }
      : null

  const npxCandidates = []
  if (inventory !== null && args !== null) {
    const rows = (inventory.rows ?? []).filter((row) => row.installed)
    // The directory this process runs from wins over any other npx copy.
    const ordered = launch?.kind === 'npx'
      ? [...rows].sort((left, right) => Number(right.running === true) - Number(left.running === true))
      : rows.sort((left, right) => compareVersions(right.version, left.version))
    for (const row of ordered) {
      for (const directory of row.paths ?? []) {
        const launcher = path.join(directory, 'node_modules', '.bin', 'dsh.cmd')
        if (existsSync(launcher)) {
          npxCandidates.push({
            kind: 'npx',
            ...shortcutInvocation(launcher, args),
            version: row.version,
            workingDirectory,
            installDirectory: directory,
          })
        }
      }
    }
  }

  return { desktop: desktopCandidate, npm: npmCandidate, npx: npxCandidates[0] ?? null }
}

/** The node binary belonging to a POSIX global prefix, or this process's node. */
function globalNodeBinary(directory) {
  const candidate = path.resolve(directory, '..', '..', '..', '..', 'bin', 'node')
  return existsSync(candidate) ? candidate : process.execPath
}

/**
 * The macOS shortcut plan: the installed `.app` bundle, a global npm install's
 * `lib/bin.js`, or an npx install's `lib/bin.js`. A CLI plan is written as a
 * double-clickable `.command` script that runs node directly.
 */
async function darwinShortcutCandidates({ launch, args, inventory, workingDirectory }) {
  const installed = await detectDesktopDarwin().catch(() => null)
  const desktopCandidate = installed === null || installed.transient === true
    ? null
    : {
        kind: 'desktop',
        target: installed.location,
        args: [],
        mode: 'direct',
        launcher: installed.location,
        version: installed.version,
        workingDirectory: path.dirname(installed.location),
      }

  let npmCandidate = null
  if (inventory !== null && args !== null) {
    const global = [...(inventory.globals ?? [])]
      .filter((entry) => typeof entry.version === 'string')
      .sort((left, right) => compareVersions(right.version, left.version))[0]
    if (global !== undefined) {
      const launcher = path.join(global.directory, 'lib', 'bin.js')
      if (existsSync(launcher)) {
        npmCandidate = {
          kind: 'npm',
          target: globalNodeBinary(global.directory),
          args,
          mode: 'mac-command',
          launcher,
          version: global.version,
          workingDirectory,
        }
      }
    }
  }

  const npxCandidates = []
  if (inventory !== null && args !== null) {
    const rows = (inventory.rows ?? []).filter((row) => row.installed)
    const ordered = launch?.kind === 'npx'
      ? [...rows].sort((left, right) => Number(right.running === true) - Number(left.running === true))
      : [...rows].sort((left, right) => compareVersions(right.version, left.version))
    for (const row of ordered) {
      for (const directory of row.paths ?? []) {
        const launcher = path.join(directory, 'node_modules', DSH, 'lib', 'bin.js')
        if (existsSync(launcher)) {
          npxCandidates.push({
            kind: 'npx',
            target: process.execPath,
            args,
            mode: 'mac-command',
            launcher,
            version: row.version,
            workingDirectory,
            installDirectory: directory,
          })
        }
      }
    }
  }

  return { desktop: desktopCandidate, npm: npmCandidate, npx: npxCandidates[0] ?? null }
}

/**
 * Where the shortcut icon is materialized. Explorer runs outside the DSH
 * sandbox and will not read an icon carrying the workspace's low integrity
 * label, so the same bytes are copied under the user's AppData directory.
 */
export function shortcutIconPath(env = process.env) {
  return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'dsh-version-manager', 'shortcut.ico')
}

/** Copy the shipped icon to a normal-integrity path; fall back to the source. */
async function prepareShortcutIcon() {
  if (!existsSync(SHORTCUT_ICON)) return null
  const target = shortcutIconPath()
  try {
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(SHORTCUT_ICON, target)
    return target
  } catch {
    return SHORTCUT_ICON
  }
}

/**
 * PowerShell that asks the shell to re-read one shortcut's icon. Explorer keeps
 * a per-item icon cache: rewriting the same `.lnk` keeps the previously
 * resolved (often generic) icon unless `SHChangeNotify` names that item.
 */
export function shellIconRefreshScript(linkPath) {
  const definition = 'using System; using System.Runtime.InteropServices; public static class DshShellNotify { [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2); }'
  return [
    `Add-Type -TypeDefinition ${psQuote(definition)} -ErrorAction SilentlyContinue`,
    `[DshShellNotify]::SHChangeNotify(0x00002000, 0x0005, ${psQuote(linkPath)}, [IntPtr]::Zero)`,
  ].join('; ')
}

/** Ask Explorer to re-read one shortcut's icon; a failure must not fail the click. */
async function refreshShortcutIcon(linkPath) {
  const encoded = Buffer.from(shellIconRefreshScript(linkPath), 'utf16le').toString('base64')
  await runCommand(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, 10000)
}

/** Write one Windows `.lnk` through WScript.Shell; returns true when it exists. */
async function writeShortcut(linkPath, target, workingDirectory, argumentsText, iconPath) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$link = $shell.CreateShortcut(${quote(linkPath)})`,
    `$link.TargetPath = ${quote(target)}`,
    argumentsText === '' || argumentsText === undefined ? null : `$link.Arguments = ${quote(argumentsText)}`,
    `$link.WorkingDirectory = ${quote(workingDirectory)}`,
    `$link.Description = 'DeepSeek Harness'`,
    iconPath === null ? null : `$link.IconLocation = ${quote(`${iconPath},0`)}`,
    '$link.Save()',
  ]
    .filter((line) => line !== null)
    .join('; ')
  const result = await runCommand(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, 20000)
  return result.code === 0 && existsSync(linkPath)
}

/**
 * A double-clickable macOS launcher. `sh` is guaranteed on macOS; node and the
 * CLI script are written as absolute single-quoted paths, so no shell profile
 * or PATH is needed when Finder starts it.
 */
export function macShortcutScript({ node, binPath, args = [], cwd } = {}) {
  if (typeof node !== 'string' || node === '' || typeof binPath !== 'string' || binPath === '') {
    throw new Error('macShortcutScript needs node and binPath')
  }
  const lines = ['#!/bin/sh']
  if (typeof cwd === 'string' && cwd !== '') lines.push(`cd ${shellQuote(cwd)} || exit 1`)
  const command = [node, binPath, ...(Array.isArray(args) ? args.map(String) : [])].map(shellQuote).join(' ')
  lines.push(`exec ${command}`)
  return `${lines.join('\n')}\n`
}

/**
 * Create (or refresh) the Desktop launcher for whatever this machine runs.
 * Refreshing is the point: a deleted shortcut comes back, and a new install
 * kind takes over the same icon. A CLI shortcut passes the running profile
 * (and the rest of the launcher arguments), because a bare launcher without a
 * profile cannot start the web app.
 */
export async function createDesktopShortcut(ctx) {
  if (process.platform === 'darwin') return createMacDesktopShortcut(ctx)
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported-platform' }
  return createWindowsDesktopShortcut(ctx)
}

/** The Windows branch: one `.lnk` written through WScript.Shell. */
async function createWindowsDesktopShortcut(ctx) {
  const target = await shortcutTarget(ctx)
  if (target === null) return { ok: false, error: 'no-install' }
  const directory = desktopDirectory()
  const info = await stat(directory).catch(() => null)
  if (info === null || !info.isDirectory()) return { ok: false, error: 'missing-desktop' }
  const icon = await prepareShortcutIcon()
  const linkPath = path.join(directory, `${SHORTCUT_NAME}.lnk`)
  const written = await writeShortcut(linkPath, target.target, target.workingDirectory, target.arguments ?? '', icon)
  if (!written) return { ok: false, error: 'write-failed', path: linkPath }
  await refreshShortcutIcon(linkPath)
  return {
    ok: true,
    path: linkPath,
    kind: target.kind,
    version: target.version,
    target: target.target,
    launcher: target.launcher ?? target.target,
    mode: target.mode ?? 'direct',
    icon,
  }
}

/**
 * The macOS branch: a `.command` script for a CLI install (Finder opens it in
 * Terminal), or a symlink to the `.app` bundle when the desktop client is the
 * target. The latter keeps the app's own icon; a `.command` uses Terminal's.
 */
async function createMacDesktopShortcut(ctx) {
  const target = await shortcutTarget(ctx)
  if (target === null) return { ok: false, error: 'no-install' }
  const directory = desktopDirectory()
  const info = await stat(directory).catch(() => null)
  if (info === null || !info.isDirectory()) return { ok: false, error: 'missing-desktop' }

  if (target.kind === 'desktop') {
    const linkPath = path.join(directory, `${SHORTCUT_NAME}.app`)
    const existing = await lstat(linkPath).catch(() => null)
    if (existing !== null && existing.isSymbolicLink() !== true) {
      return { ok: false, error: 'path-exists', path: linkPath }
    }
    if (existing !== null) await unlink(linkPath).catch(() => {})
    try {
      await symlink(target.target, linkPath)
    } catch (error) {
      return { ok: false, error: 'write-failed', path: linkPath, detail: String(error?.message ?? error) }
    }
    return {
      ok: true,
      path: linkPath,
      kind: target.kind,
      version: target.version ?? null,
      target: target.target,
      launcher: target.launcher ?? target.target,
      mode: 'direct',
      icon: null,
    }
  }

  const scriptPath = path.join(directory, `${SHORTCUT_NAME}.command`)
  const existing = await lstat(scriptPath).catch(() => null)
  if (existing !== null && existing.isDirectory()) {
    return { ok: false, error: 'path-exists', path: scriptPath }
  }
  try {
    await rm(scriptPath, { force: true })
    const script = macShortcutScript({
      node: target.target,
      binPath: target.launcher,
      args: target.args ?? [],
      cwd: target.workingDirectory,
    })
    await writeFile(scriptPath, script, { mode: 0o755 })
    await chmod(scriptPath, 0o755)
  } catch (error) {
    return { ok: false, error: 'write-failed', path: scriptPath, detail: String(error?.message ?? error) }
  }
  return {
    ok: true,
    path: scriptPath,
    kind: target.kind,
    version: target.version ?? null,
    target: target.target,
    launcher: target.launcher,
    mode: 'mac-command',
    icon: null,
  }
}

/* -------------------------------------------------------------------------- */
/* directory measurement (deferred: stat is the expensive part of a scan)      */
/* -------------------------------------------------------------------------- */

/** Whether a directory names one direct child of a known `_npx` root. */
function isKnownNpxInstall(directory) {
  let resolved
  try {
    resolved = path.resolve(directory)
  } catch {
    return false
  }
  for (const root of npmCacheRoots()) {
    const npxRoot = path.join(root, '_npx')
    const relative = path.relative(npxRoot, resolved)
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) continue
    if (relative.split(path.sep).length === 1) return true
  }
  return false
}

/**
 * Measure the requested install directories, ignoring anything that is not a
 * direct `_npx` child of a known cache root.
 * @param directories - paths reported by a previous `scanAll`.
 */
export async function measureDirectories(directories) {
  const wanted = [...new Set((Array.isArray(directories) ? directories : []).filter((entry) => typeof entry === 'string').filter(isKnownNpxInstall))].slice(0, 32)
  const sizes = {}
  await Promise.all(
    wanted.map(async (directory) => {
      const info = await stat(directory).catch(() => null)
      sizes[directory] = info === null ? 0 : await measuredSize(directory, info.mtimeMs).catch(() => 0)
    }),
  )
  return { ok: true, sizes }
}

/* -------------------------------------------------------------------------- */
/* deletion                                                                   */
/* -------------------------------------------------------------------------- */

/** Absolute path of the content blob behind one integrity string. */
function blobPath(cacheRoot, integrity) {
  const dash = integrity.indexOf('-')
  if (dash === -1) return null
  const algorithm = integrity.slice(0, dash)
  let hex
  try {
    hex = Buffer.from(integrity.slice(dash + 1), 'base64').toString('hex')
  } catch {
    return null
  }
  if (!/^[0-9a-f]+$/.test(hex)) return null
  return path.join(cacheRoot, '_cacache', 'content-v2', algorithm, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4))
}

/**
 * Remove every dsh tarball entry of `versions` from one cache root, then
 * delete only the content blobs no remaining index entry references.
 * @returns bytes released from content blobs plus removed index bytes.
 */
async function removeCacheEntries(root, versions) {
  const indexRoot = path.join(root, '_cacache', 'index-v5')
  if (!existsSync(indexRoot)) return { bytes: 0, entries: 0, files: 0 }

  const files = []
  for await (const file of walkFiles(indexRoot)) files.push(file)
  const contents = await mapLimit(files, 32, async (file) => {
    try {
      return await readFile(file, 'utf8')
    } catch {
      return null
    }
  })

  const edits = []
  const removedDigests = new Set()
  const referenced = new Map()
  let removedEntries = 0
  /** An index file we could not read hides unknown references; never collect blobs then. */
  let safeToCollectBlobs = true

  for (let index = 0; index < files.length; index += 1) {
    const text = contents[index]
    if (text === null) {
      safeToCollectBlobs = false
      continue
    }
    const keep = []
    let changed = false
    for (const line of text.split('\n')) {
      if (!line) continue
      const entry = parseIndexLine(line)
      const hit = entry === null ? null : tarballOfKey(entry.key)
      if (hit !== null && versions.has(hit.version)) {
        if (typeof entry.integrity === 'string') removedDigests.add(entry.integrity)
        removedEntries += 1
        changed = true
        continue
      }
      keep.push(line)
      if (typeof entry?.integrity === 'string') {
        referenced.set(entry.integrity, (referenced.get(entry.integrity) ?? 0) + 1)
      }
    }
    if (changed) edits.push({ file: files[index], keep })
  }

  let bytes = 0
  let removedFiles = 0
  for (const edit of edits) {
    if (edit.keep.length === 0) {
      const size = await stat(edit.file).then((info) => info.size).catch(() => 0)
      try {
        await unlink(edit.file)
        bytes += size
        removedFiles += 1
      } catch {
        /* a locked index file keeps its entry alive; skip blob collection below */
        safeToCollectBlobs = false
      }
    } else {
      try {
        await writeFile(edit.file, `${edit.keep.join('\n')}\n`)
        removedFiles += 1
      } catch {
        safeToCollectBlobs = false
      }
    }
  }

  if (safeToCollectBlobs) {
    for (const integrity of removedDigests) {
      if ((referenced.get(integrity) ?? 0) > 0) continue
      const blob = blobPath(root, integrity)
      if (blob === null) continue
      const info = await stat(blob).catch(() => null)
      if (info === null) continue
      try {
        await unlink(blob)
        bytes += info.size
      } catch {
        /* blob shared or locked: keep it */
      }
    }
  }

  return { bytes, entries: removedEntries, files: removedFiles }
}

/**
 * Delete dsh versions: their `_npx` install directories and their cache
 * entries. Refuses the newest installed version and the running one.
 * @param request.mode - `version` (install plus cache) or `cache` (cache only).
 * @param request.versions - exact versions to remove.
 */
export async function deleteVersions(request = {}) {
  const mode = request.mode === 'cache' ? 'cache' : 'version'
  const requested = Array.isArray(request.versions) ? request.versions.filter((value) => typeof value === 'string') : []
  if (requested.length === 0) return { ok: false, error: 'no-version' }

  const scan = await scanAll({ measure: false })
  const wanted = new Set(requested)
  const refused = []
  const accepted = []
  for (const row of scan.rows) {
    if (!wanted.has(row.version)) continue
    if (row.latest) {
      refused.push({ version: row.version, reason: 'latest' })
      continue
    }
    if (row.running) {
      refused.push({ version: row.version, reason: 'running' })
      continue
    }
    if (mode === 'version' && !row.installed) {
      refused.push({ version: row.version, reason: 'cache-only' })
      continue
    }
    if (mode === 'cache' && row.installed) {
      refused.push({ version: row.version, reason: 'installed' })
      continue
    }
    accepted.push(row)
  }
  if (accepted.length === 0) {
    return { ok: false, error: refused.length > 0 ? 'refused' : 'not-found', refused }
  }

  const errors = []
  const removed = []
  const cacheRoots = new Set()

  for (const row of accepted) {
    let installBytes = 0
    for (const install of row.installs) {
      const info = await stat(install.directory).catch(() => null)
      const size = info === null ? 0 : await measuredSize(install.directory, info.mtimeMs).catch(() => 0)
      try {
        await rm(install.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
        installBytes += size
        sizeCache.delete(install.directory)
      } catch (error) {
        errors.push({ version: row.version, path: install.directory, message: String(error?.message ?? error) })
      }
    }
    if (row.cache !== null) {
      for (const root of row.cache.roots) cacheRoots.add(root)
    }
    removed.push({ version: row.version, installBytes, bytes: installBytes, cacheBytes: 0 })
  }

  const versions = new Set(accepted.map((row) => row.version))
  let cacheFreed = 0
  for (const root of cacheRoots) {
    try {
      const result = await removeCacheEntries(root, versions)
      cacheFreed += result.bytes
    } catch (error) {
      errors.push({ version: '*', path: root, message: String(error?.message ?? error) })
    }
  }
  const installFreed = removed.reduce((total, item) => total + item.installBytes, 0)
  for (const item of removed) item.cacheBytes = accepted.find((row) => row.version === item.version)?.cacheBytes ?? 0

  return {
    ok: true,
    mode,
    freed: installFreed + cacheFreed,
    installFreed,
    cacheFreed,
    removed,
    refused,
    errors,
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP routes                                                                */
/* -------------------------------------------------------------------------- */

/** Send one JSON response. */
function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

/** Read a bounded UTF-8 request body; null past the ceiling. */
async function readBoundedBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      request.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** The route carrier plus the composition's trust fence. */
export const inject = ['webServer', 'connection']

/** Register the scan and delete routes. */
export function apply(ctx) {
  const connection = ctx.connection
  const rejected = (request, response) => {
    const rejection = connection.requestRejection(request)
    if (rejection === undefined) return false
    response.statusCode = rejection
    response.end()
    return true
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_LIST,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'GET' && request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            const inventory = await scanAll({ measure: false })
            sendJson(response, 200, { ...inventory, runtime: runtimeInfo(ctx) })
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_LIST}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_SIZES,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          let text
          try {
            text = await readBoundedBody(request)
          } catch {
            text = null
          }
          if (text === null) {
            sendJson(response, 413, { ok: false, error: 'body-too-large' })
            return
          }
          let body
          try {
            body = JSON.parse(text || '{}')
          } catch {
            sendJson(response, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            sendJson(response, 200, await measureDirectories(body?.directories))
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_SIZES}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_REGISTRY,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'GET' && request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          let force = false
          try {
            const url = new URL(String(request.url ?? ROUTE_REGISTRY), 'http://localhost')
            force = url.searchParams.get('force') === '1'
          } catch {
            force = false
          }
          try {
            sendJson(response, 200, registryPayload(await fetchRegistry({ force })))
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_REGISTRY}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_UPGRADE,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          let text
          try {
            text = await readBoundedBody(request)
          } catch {
            text = null
          }
          if (text === null) {
            sendJson(response, 413, { ok: false, error: 'body-too-large' })
            return
          }
          let body
          try {
            body = JSON.parse(text || '{}')
          } catch {
            sendJson(response, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            const result = await upgradeVersion({ target: body?.target, version: body?.version })
            sendJson(response, result.ok ? 200 : 409, result)
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_UPGRADE}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_RESTART,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          let text
          try {
            text = await readBoundedBody(request)
          } catch {
            text = null
          }
          if (text === null) {
            sendJson(response, 413, { ok: false, error: 'body-too-large' })
            return
          }
          let body
          try {
            body = JSON.parse(text || '{}')
          } catch {
            sendJson(response, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            const result = await restartVersion(ctx, body)
            if (!result.ok) {
              sendJson(response, 409, { ok: false, error: result.error, detail: result.detail })
              return
            }
            // Answer first; the helper waits for this PID to disappear and then
            // starts the new install, so the response must not race the dispose.
            response.once('finish', () => {
              setTimeout(() => {
                try {
                  result.exit(0)
                } catch {
                  /* the helper's grace kill still frees the port */
                }
                setTimeout(() => process.exit(0), 6000).unref?.()
              }, 500)
            })
            sendJson(response, 200, {
              ok: true,
              restarting: true,
              target: result.target,
              version: result.version,
              pid: result.pid,
              log: result.log,
            })
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_RESTART}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_DELETE,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          let text
          try {
            text = await readBoundedBody(request)
          } catch {
            text = null
          }
          if (text === null) {
            sendJson(response, 413, { ok: false, error: 'body-too-large' })
            return
          }
          let body
          try {
            body = JSON.parse(text || '{}')
          } catch {
            sendJson(response, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            const result = await deleteVersions({
              mode: body?.mode,
              versions: body?.versions,
            })
            sendJson(response, result.ok ? 200 : 409, result)
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_DELETE}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_DESKTOP,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'GET' && request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            sendJson(response, 200, await desktopSnapshot())
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_DESKTOP}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_DESKTOP_INSTALL,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          let text
          try {
            text = await readBoundedBody(request)
          } catch {
            text = null
          }
          if (text === null) {
            sendJson(response, 413, { ok: false, error: 'body-too-large' })
            return
          }
          let body
          try {
            body = JSON.parse(text || '{}')
          } catch {
            sendJson(response, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            const result = await installDesktop({ directory: body?.directory })
            sendJson(response, result.ok ? 200 : 409, result)
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_DESKTOP_INSTALL}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_TIP_QRCODE,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            const data = await readFile(path.join(PLUGIN_ROOT, 'assets', 'dashang.jpg'))
            response.statusCode = 200
            response.setHeader('content-type', 'image/jpeg')
            response.setHeader('cache-control', 'private, max-age=3600')
            response.setHeader('content-length', String(data.length))
            if (request.method === 'HEAD') response.end()
            else response.end(data)
          } catch {
            sendJson(response, 404, { ok: false, error: 'not-found' })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_TIP_QRCODE}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_SHORTCUT,
        handler: async (request, response) => {
          if (rejected(request, response)) return
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            const result = await createDesktopShortcut(ctx)
            sendJson(response, result.ok ? 200 : 409, result)
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    `dsh-version-manager: ${ROUTE_SHORTCUT}`,
  )
}