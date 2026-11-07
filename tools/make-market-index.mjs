#!/usr/bin/env node
/**
 * Build a format-1 DSH plugin market index for an npm or Git-hosted release.
 *
 * The public DSH market format accepts npm or Git sources, not zip files.
 * npm is the default now that the package is published; Git remains available
 * for a commit-pinned release.
 *
 * Usage:
 *   node tools/make-market-index.mjs [--version 1.0.0] [--out market/index.json]
 *   node tools/make-market-index.mjs --source git --repo https://github.com/user/repo \
 *     --commit <40-hex-sha> [--path <repo-subdir>] [--out market/index.json]
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PACKAGE = JSON.parse(await readFile(path.join(PLUGIN_DIR, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`[make-market-index] ${message}`)
  process.exit(1)
}

function note(message) {
  console.log(`[make-market-index] ${message}`)
}

function usage() {
  console.log(`用法: node tools/make-market-index.mjs [选项]

选项:
  --source <npm|git>  安装源；默认 npm
  --repo <url>        可选仓库 HTTPS 地址；npm 下仅用于展示，git 下必填
  --commit <sha>      git 源必须：40 位小写 commit；默认当前仓库 HEAD
  --version <semver>  发布版本；默认 package.json version
  --path <subdir>     git 源可选：插件在仓库中的子目录
  --homepage <url>    可选主页
  --author <text>     可选作者
  --repo-dir <dir>    读取 git 信息的目录；默认本插件目录
  --out <file>        输出文件；默认 market/index.json
  -h, --help          显示本帮助

说明:
  npm 源生成 ${PACKAGE.name}@<version>；git 源生成带 commit 的 git+https spec。
  生成的是完整 format 1 索引。把它放到 HTTPS 静态站点后，在 DSH 插件市场的
  索引设置里添加该 URL 即可。zip 不是市场安装源；zip 请使用本插件根目录的
  install.cmd / install.sh 离线安装。
`)
}

function parseArgs(argv) {
  const options = {
    source: 'npm',
    repo: null,
    commit: null,
    version: PACKAGE.version,
    path: null,
    homepage: null,
    author: null,
    repoDir: PLUGIN_DIR,
    out: path.join(PLUGIN_DIR, 'market', 'index.json'),
  }
  const keys = new Map([
    ['--source', 'source'],
    ['--repo', 'repo'],
    ['--commit', 'commit'],
    ['--version', 'version'],
    ['--path', 'path'],
    ['--homepage', 'homepage'],
    ['--author', 'author'],
    ['--repo-dir', 'repoDir'],
    ['--out', 'out'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '-h' || argument === '--help') {
      usage()
      process.exit(0)
    }
    const separator = argument.indexOf('=')
    const key = separator === -1 ? argument : argument.slice(0, separator)
    const target = keys.get(key)
    if (target === undefined) fail(`未知参数: ${argument}`)
    const value = separator === -1 ? argv[index + 1] : argument.slice(separator + 1)
    if (typeof value !== 'string' || value === '') fail(`${key} 需要一个值`)
    options[target] = value
    if (separator === -1) index += 1
  }
  return options
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function normalizeRepo(value) {
  let text = String(value).trim().replace(/\/+$/, '')
  const scp = /^git@([^:]+):(.+)$/.exec(text)
  if (scp !== null) text = `https://${scp[1]}/${scp[2]}`
  const ssh = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(text)
  if (ssh !== null) text = `https://${ssh[1]}/${ssh[2]}`
  if (!text.startsWith('https://')) fail(`仓库地址必须是 HTTPS: ${value}`)
  if (text.includes('?') || text.includes('#')) fail('仓库地址不能带查询参数或 fragment')
  try {
    const url = new URL(text)
    if (url.pathname.split('/').filter(Boolean).length < 2) fail('仓库地址至少要包含 owner/repo 两段路径')
  } catch {
    fail(`仓库地址不是合法 URL: ${value}`)
  }
  return text
}

function normalizeSubdir(value) {
  if (value === null) return null
  const text = String(value).replace(/^\/+|\/+$/g, '')
  if (text === '') return null
  if (text.split('/').some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._@+-]+$/.test(segment))) {
    fail(`--path 必须是合法的相对目录: ${value}`)
  }
  return text
}

const options = parseArgs(process.argv.slice(2))
const sourceType = String(options.source).toLowerCase()
if (sourceType !== 'npm' && sourceType !== 'git') fail('--source 只能是 npm 或 git')
const repoDir = path.resolve(options.repoDir)
const repoInput = options.repo ?? (sourceType === 'git' ? git(['remote', 'get-url', 'origin'], repoDir) : null)
const repo = repoInput === null ? null : normalizeRepo(repoInput)
if (sourceType === 'git' && repo === null) fail('git 源缺少 --repo，且当前目录没有 git remote origin')
const subdir = sourceType === 'git' ? normalizeSubdir(options.path) : null
if (sourceType === 'npm' && options.path !== null) fail('--path 只适用于 --source git')

let commit = null
if (sourceType === 'git') {
  commit = options.commit ?? git(['rev-parse', 'HEAD'], repoDir) ?? fail('缺少 --commit，且当前目录不是 git 仓库')
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('--commit 必须是 40 位小写十六进制 SHA')
}

const version = String(options.version)
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) fail(`--version 不是合法 SemVer: ${version}`)
if (options.homepage !== null && !/^https?:\/\/[^\s]+$/.test(options.homepage)) {
  fail(`--homepage 必须是 http(s) URL: ${options.homepage}`)
}

const iconBytes = await readFile(path.join(PLUGIN_DIR, 'icon.svg'))
if (iconBytes.length > 32 * 1024) fail('icon.svg 超过市场内联图标 32 KiB 限制')
const icon = `data:image/svg+xml;base64,${iconBytes.toString('base64')}`

let zhDescription = 'DSH安装版本管理、自动升级、桌面快捷方式、便捷重启。'
try {
  const locale = JSON.parse(await readFile(path.join(PLUGIN_DIR, 'locale', 'zh.json'), 'utf8'))
  if (typeof locale?.meta?.description === 'string' && locale.meta.description !== '') {
    zhDescription = locale.meta.description
  }
} catch {
  /* keep the default */
}

const titleEn = 'DSH Version Manager'
const titleZh = 'DSH 版本管理'
const entry = {
  name: PACKAGE.name,
  title: { en: titleEn, zh: titleZh },
  description: { en: PACKAGE.description, zh: zhDescription },
  icon,
  ...(options.author === null ? {} : { author: options.author }),
  ...(options.homepage === null ? {} : { homepage: options.homepage }),
  ...(repo === null ? {} : {
    repository: {
      url: repo,
      ...(subdir === null ? {} : { directory: subdir }),
    },
  }),
  metadata: {
    category: 'dev',
    keywords: ['dsh', 'version-manager', 'upgrade', 'desktop', 'restart'],
    labels: [],
    sortKeys: {},
  },
  versions: [{
    version,
    publishTimestamp: Math.floor(Date.now() / 1000),
    source: sourceType === 'npm'
      ? { type: 'npm' }
      : {
          type: 'git',
          url: repo,
          commit,
          ...(subdir === null ? {} : { path: subdir }),
        },
    engines: {},
  }],
}

const index = {
  format: 1,
  title: { en: 'DSH Version Manager', zh: 'DSH 版本管理' },
  description: {
    en: 'DSH plugin market index for the DSH version manager.',
    zh: 'DSH 版本管理插件的市场索引。',
  },
  metadata: {
    categories: {
      dev: { title: { en: 'Development & Runtime', zh: '开发与运行时' } },
    },
    labels: {},
    sortKeys: {},
  },
  plugins: [entry],
}

const out = path.resolve(options.out)
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, `${JSON.stringify(index, null, 2)}\n`)
const installSpec = sourceType === 'npm'
  ? `${PACKAGE.name}@${version}`
  : `git+${repo.endsWith('.git') ? repo : `${repo}.git`}#${commit}${subdir === null ? '' : `&path:/${subdir}`}`

note(`已写入 ${out}`)
note(`市场安装 spec: ${installSpec}`)
note('下一步: 把 index.json 放到 HTTPS 静态站点，在 DSH 插件市场的索引设置里添加该 URL。')
note('zip 不是市场安装源；离线机器请解压后运行 install.cmd / install.sh。')
