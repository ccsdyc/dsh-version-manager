#!/usr/bin/env node
/**
 * Offline installer for the DSH version manager.
 *
 * A zip is only transport: DSH itself installs plugins from a package name,
 * a local path, a Git URL, or a tarball. This script turns an extracted folder
 * into a profile install without npm: it locates the target profile, adds the
 * folder as a `link:` dependency, selects the bundle, and creates the local
 * package link. When the `dsh` CLI is available it uses the official
 * `dsh plugin --profile <name> add <spec>` path first.
 *
 * Usage:
 *   node install.mjs [--profile web] [--dsh <path-to-dsh>] [--dry-run] [--no-cli]
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE = JSON.parse(await readFile(path.join(PLUGIN_DIR, 'package.json'), 'utf8'))
const NAME = PACKAGE.name
const VERSION = PACKAGE.version
const IS_WIN = process.platform === 'win32'

function fail(message) {
  console.error(`[dsh-version-manager] ${message}`)
  process.exit(1)
}

function note(message) {
  console.log(`[dsh-version-manager] ${message}`)
}

function usage() {
  console.log(`用法: node install.mjs [选项]

选项:
  --profile <name>  目标 DSH profile（默认 $DSH_PROFILE 或 web）
  --dsh <path>      dsh 可执行文件；默认在 PATH 与 npx 缓存中查找
  --dry-run         只显示计划，不修改任何文件
  --no-cli          不调用 dsh CLI，直接写入 profile 并创建本地链接
  -h, --help        显示本帮助

说明:
  安装前请先完全退出 DSH。安装完成后重新启动 DSH，本插件才会加载。
`)
}

function parseArgs(argv) {
  const options = {
    profile: process.env.DSH_PROFILE || 'web',
    dsh: process.env.DSH_CLI || null,
    dryRun: false,
    noCli: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile' || argument === '--dsh') {
      const value = argv[index + 1]
      if (typeof value !== 'string' || value === '') fail(`${argument} 需要一个值`)
      options[argument === '--profile' ? 'profile' : 'dsh'] = value
      index += 1
    } else if (argument.startsWith('--profile=')) {
      options.profile = argument.slice('--profile='.length)
    } else if (argument.startsWith('--dsh=')) {
      options.dsh = argument.slice('--dsh='.length)
    } else if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--no-cli') {
      options.noCli = true
    } else if (argument === '-h' || argument === '--help') {
      usage()
      process.exit(0)
    } else {
      fail(`未知参数: ${argument}`)
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.profile)) fail(`profile 名称不合法: ${options.profile}`)
  return options
}

function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function whereWindows(name) {
  const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 || typeof result.stdout !== 'string') return null
  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate !== '' && isFile(candidate)) return candidate
  }
  return null
}

function findOnPath() {
  if (IS_WIN) {
    for (const name of ['dsh.cmd', 'dsh.exe', 'dsh']) {
      const found = whereWindows(name)
      if (found !== null) return found
    }
    return null
  }
  const result = spawnSync('/bin/sh', ['-c', 'command -v dsh'], { encoding: 'utf8' })
  if (result.status !== 0 || typeof result.stdout !== 'string') return null
  const candidate = result.stdout.trim()
  return candidate !== '' && isFile(candidate) ? candidate : null
}

function findNpxCli() {
  const roots = []
  if (IS_WIN) {
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'))
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm-cache', '_npx'))
  } else {
    roots.push(path.join(os.homedir(), '.npm', '_npx'))
  }
  const candidates = []
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const bin = path.join(root, entry.name, 'node_modules', '.bin', IS_WIN ? 'dsh.cmd' : 'dsh')
      if (!isFile(bin)) continue
      try {
        candidates.push({ bin, mtime: statSync(bin).mtimeMs })
      } catch {
        /* ignore a disappearing cache entry */
      }
    }
  }
  candidates.sort((left, right) => right.mtime - left.mtime)
  return candidates[0]?.bin ?? null
}

function findDshCli(explicit) {
  if (typeof explicit === 'string' && explicit !== '') {
    let candidate = path.resolve(expandHome(explicit))
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      candidate = path.join(candidate, IS_WIN ? 'dsh.cmd' : 'dsh')
    }
    if (!isFile(candidate)) fail(`找不到 dsh 可执行文件: ${candidate}`)
    return candidate
  }
  return findOnPath() ?? findNpxCli()
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function runDsh(cli, args) {
  note(`调用: ${cli} ${args.join(' ')}`)
  let result
  if (IS_WIN && /\.(?:cmd|bat)$/i.test(cli)) {
    const command = `${cmdQuote(cli)} ${args.map(cmdQuote).join(' ')}`
    result = spawnSync(command, { stdio: 'inherit', shell: true })
  } else {
    result = spawnSync(cli, args, { stdio: 'inherit' })
  }
  if (result.error) fail(`dsh 启动失败: ${String(result.error.message ?? result.error)}`)
  if (result.status !== 0) fail(`dsh plugin 失败（退出码 ${String(result.status)}）；请检查上方输出，或改用 --no-cli 直接链接安装。`)
}

async function readProfile(profileFile) {
  let text
  try {
    text = (await readFile(profileFile, 'utf8')).replace(/^\uFEFF/, '')
  } catch (error) {
    fail(`无法读取 profile: ${profileFile} (${String(error.message ?? error)})`)
  }
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    fail(`profile package.json 不是合法 JSON: ${String(error.message ?? error)}`)
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    fail('profile package.json 顶层必须是对象')
  }
  return { text, manifest }
}

function bundleList(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (bundles === undefined) return []
  if (!Array.isArray(bundles)) fail('profile 的 dsh.profile.bundles 必须是数组')
  return bundles
}

async function linkPackage(profileDir) {
  const linkPath = path.join(profileDir, 'node_modules', ...NAME.split('/'))
  await mkdir(path.dirname(linkPath), { recursive: true })
  const existing = await lstat(linkPath).catch(() => null)
  if (existing !== null) {
    if (!existing.isSymbolicLink()) {
      note(`已存在非链接的 ${linkPath}，保持不动（可能由 pnpm 复制安装）。`)
      return false
    }
    const target = await readlink(linkPath).catch(() => null)
    if (target !== null && path.resolve(path.dirname(linkPath), target) === PLUGIN_DIR) return true
    await unlink(linkPath).catch(() => {})
  }
  try {
    await symlink(PLUGIN_DIR, linkPath, IS_WIN ? 'junction' : 'dir')
    note(`已创建本地链接: ${linkPath} -> ${PLUGIN_DIR}`)
    return true
  } catch (error) {
    note(`创建本地链接失败: ${String(error.message ?? error)}`)
    return false
  }
}

async function writeProfile(profileFile, manifest) {
  const before = await readFile(profileFile, 'utf8')
  const next = JSON.parse(JSON.stringify(manifest))
  next.dependencies ??= {}
  if (typeof next.dependencies !== 'object' || next.dependencies === null || Array.isArray(next.dependencies)) {
    fail('profile 的 dependencies 必须是对象')
  }
  const spec = `link:${PLUGIN_DIR.replace(/\\/g, '/')}`
  next.dependencies[NAME] = spec
  next.dsh ??= {}
  if (typeof next.dsh !== 'object' || next.dsh === null || Array.isArray(next.dsh)) {
    fail('profile 的 dsh 字段必须是对象')
  }
  next.dsh.profile ??= {}
  if (typeof next.dsh.profile !== 'object' || next.dsh.profile === null || Array.isArray(next.dsh.profile)) {
    fail('profile 的 dsh.profile 字段必须是对象')
  }
  if (!Array.isArray(next.dsh.profile.bundles)) {
    fail('profile 缺少 dsh.profile.bundles 数组；请先用 DSH 正常初始化该 profile。')
  }
  const bundles = next.dsh.profile.bundles
  if (!bundles.includes(NAME)) bundles.push(NAME)
  next.dsh.profile.bundles = bundles
  const after = `${JSON.stringify(next, null, 2)}\n`
  if (after === before) {
    note('profile 已包含本插件，无需修改。')
    return false
  }
  await copyFile(profileFile, `${profileFile}.dshvm-backup`)
  await writeFile(profileFile, after)
  note(`已写入 profile: ${profileFile}`)
  note(`已备份原文件: ${profileFile}.dshvm-backup`)
  return true
}

const options = parseArgs(process.argv.slice(2))
const dshHome = path.resolve(expandHome(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')))
const profileDir = path.join(dshHome, 'profiles', options.profile)
const profileFile = path.join(profileDir, 'package.json')
if (!existsSync(profileFile)) {
  fail(`没有找到 profile: ${profileFile}\n请先用 DSH 启动一次该 profile，或通过 --profile 指定已有 profile。`)
}

const { manifest } = await readProfile(profileFile)
const selected = bundleList(manifest).includes(NAME)
const cli = options.noCli ? null : findDshCli(options.dsh)
const spec = `link:${PLUGIN_DIR.replace(/\\/g, '/')}`
const linkPath = path.join(profileDir, 'node_modules', ...NAME.split('/'))
const linked = existsSync(linkPath)

note(`插件: ${NAME}@${VERSION}`)
note(`目录: ${PLUGIN_DIR}`)
note(`DSH_HOME: ${dshHome}`)
note(`profile: ${options.profile}`)
note(`安装 spec: ${spec}`)
note(cli === null ? 'dsh CLI: 未找到，将直接写入 profile 并创建本地链接。' : `dsh CLI: ${cli}`)
note(`bundle 已选中: ${selected ? '是' : '否'}`)
note(`本地链接已存在: ${linked ? '是' : '否'}`)

if (options.dryRun) {
  note('--dry-run: 未做任何修改。')
  process.exit(0)
}

if (cli !== null) {
  runDsh(cli, ['plugin', '--profile', options.profile, 'add', spec])
} else {
  note('未找到 dsh CLI，使用离线链接模式。若之后运行 pnpm install，请确认 profile 仍保留该 link 依赖。')
}

await linkPackage(profileDir)
const fresh = await readProfile(profileFile)
await writeProfile(profileFile, fresh.manifest)
note('安装完成。请完全退出并重新启动 DSH，然后刷新浏览器页面；Host 代码只在 DSH 启动时载入。')
