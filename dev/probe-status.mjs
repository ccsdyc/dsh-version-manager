/**
 * Renders the panel with a stubbed React whose `useState` returns a supplied
 * state queue, so the status line can be checked against real-looking data:
 *
 * - running 0.2.2-alpha.2 while 0.2.2-alpha.3 is installed must read
 *   "运行中 0.2.2-alpha.2 · 最新安装 0.2.2-alpha.3" and offer "重启到 ...";
 * - running 0.2.2-alpha.3 must read "运行中 0.2.2-alpha.3" and offer no restart.
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const baseRow = (version, running) => ({
  version,
  installed: true,
  running,
  latest: !running,
  bytes: 0,
  installBytes: 0,
  cacheBytes: 0,
  measured: true,
  paths: [],
  packages: [],
  lastUsed: 0,
})

const registry = { ok: true, rc: '0.2.1-rc.5', alpha: '0.2.2-alpha.3', registry: 'test', tags: {} }

function inventoryFor(runningVersion, upgrading = null) {
  return {
    ok: true,
    measured: true,
    rows: [baseRow('0.2.2-alpha.3', runningVersion === '0.2.2-alpha.3'), baseRow('0.2.2-alpha.2', runningVersion === '0.2.2-alpha.2')],
    globals: [],
    cacheRoots: [],
    totals: { reclaimableBytes: 0, cacheOnly: 0, cacheBytes: 0, installBytes: 0 },
    runtime: {
      kind: 'npx',
      hash: runningVersion === '0.2.2-alpha.3' ? 'f952829a1b7f9589' : 'bd325e168b7188a4',
      version: runningVersion,
      pid: 4242,
      canRestart: true,
      upgrading,
    },
  }
}

/** `useLanguage` consumes the first slot; then the page's own states follow. */
let queue = []
/** Values handed to a `setState`, so a click can be replayed into the next render. */
let setters = []
const React = {
  useState: (initial) => {
    const value = queue.length > 0 ? queue.shift() : typeof initial === 'function' ? initial() : initial
    return [value, (next) => { setters.push(typeof next === 'function' ? next(value) : next) }]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
}

/** Every request the panel makes, so a click can be followed to its route. */
let requests = []
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method ?? 'GET', body: init.body ?? null })
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

let captured = null
const loader = {
  load(options) {
    captured = options.factory((id) => {
      if (id === 'react') return React
      throw new Error(`unexpected require: ${id}`)
    })
    return captured
  },
}

globalThis.window = {
  __ModuleLoader__: loader,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
  location: { reload() {} },
}
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.document = { createElement: () => ({ textContent: '' }), head: { appendChild() {} } }

new Function('window', 'localStorage', 'document', source)(globalThis.window, globalThis.localStorage, globalThis.document)

let mainComponent = null
const ctx = {
  slots: {
    inject: (name, fn) => {
      fn()
      return () => {}
    },
    register: (options, Component) => {
      if (options.name === 'main') mainComponent = Component
      return () => {}
    },
  },
  effect: (fn) => {
    fn()
    return () => {}
  },
  get: () => undefined,
}
captured.apply(ctx)

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function resolve(node) {
  let current = node
  for (let depth = 0; depth < 20; depth += 1) {
    if (current === null || current === undefined) return current
    if (Array.isArray(current)) return current.map(resolve)
    if (typeof current !== 'object') return current
    if (typeof current.type === 'function' && current.type !== React.Fragment) {
      current = current.type(current.props ?? {})
      continue
    }
    return { ...current, children: (current.children ?? []).map(resolve) }
  }
  return current
}

function render(inventory, busy = null, desktop = null, dismissed = {}, pickedArea = null, pending = null) {
  queue = ['zh', inventory, registry, null, null, false, false, busy, null, pending, false, desktop, false, false, pickedArea, null, dismissed]
  const tree = resolve(mainComponent({ pickDirectory: async () => null }))
  let status = null
  let action = null
  let dialogTitle = null
  let dialogStatus = null
  let restartButton = null
  let desktopDot = false
  let latestBadge = null
  let upgradeButton = null
  let confirmButton = null
  let titleNode = null
  const buttons = []
  const dialogLines = []
  walk(tree, (node) => {
    const cls = node.props?.className
    if (typeof cls === 'string' && cls.split(' ').includes('dshvm-btn')) {
      buttons.push({
        className: cls,
        text: (node.children ?? []).flat(Infinity).filter((child) => typeof child === 'string').join(''),
        node,
      })
      if (cls.split(' ').includes('dshvm-btn-danger')) confirmButton = node
    }
    if (cls === 'dshvm-heading') {
      for (const child of (node.children ?? []).flat(Infinity)) {
        if (child?.type === 'h1') titleNode = child
      }
    }
    if (cls === 'dshvm-status-main') status = (node.children ?? []).filter((child) => typeof child === 'string').join('')
    if (typeof cls === 'string' && cls.includes('dshvm-status-action')) {
      action = (node.children ?? []).filter((child) => typeof child === 'string').join('')
    }
    if (typeof cls === 'string' && cls.split(' ').includes('dshvm-btn') && (node.children ?? []).flat(Infinity).includes('重启 DSH')) {
      restartButton = node
    }
    if (typeof cls === 'string' && cls.split(' ').includes('dshvm-badge-latest')) {
      latestBadge = (node.children ?? []).filter((child) => typeof child === 'string').join('')
    }
    if (typeof cls === 'string' && cls.split(' ').includes('dshvm-btn') && (node.children ?? []).flat(Infinity).includes('升级')) {
      upgradeButton = node
    }
    if (cls === 'dshvm-switch-dot') desktopDot = true
    if (cls === 'dshvm-dialog') {
      for (const child of (node.children ?? []).flat(Infinity)) {
        if (child?.type === 'h2') dialogTitle = (child.children ?? []).filter((entry) => typeof entry === 'string').join('')
        if (child?.type === 'p') dialogLines.push((child.children ?? []).filter((entry) => typeof entry === 'string').join(''))
        if (child?.props?.className === 'dshvm-restart-status') {
          dialogStatus = (child.children ?? []).filter((entry) => typeof entry === 'string').join('')
        }
      }
    }
  })
  return { status, action, dialogTitle, dialogStatus, dialogLines, restartButton, desktopDot, latestBadge, upgradeButton, confirmButton, buttons, title: titleNode === null ? null : textOf(titleNode) }
}

/** Every string inside a rendered subtree, in order. */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return ''
  return (node.children ?? []).map(textOf).join('')
}

const failures = []
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(name)
}

const stale = render(inventoryFor('0.2.2-alpha.2'))
check(
  'stale process: status names the running version and the newest install',
  stale.status === '运行中 0.2.2-alpha.2 · 最新安装 0.2.2-alpha.3',
  stale.status ?? '',
)
check('stale process: restart action is offered', stale.action === '重启到 0.2.2-alpha.3', stale.action ?? '')
check(
  'toolbar restart button is enabled for a CLI launch',
  stale.restartButton !== null && stale.restartButton.props.disabled === false,
  stale.restartButton === null ? 'missing' : String(stale.restartButton.props.disabled),
)

const current = render(inventoryFor('0.2.2-alpha.3'))
check('restarted process: status names only the running version', current.status === '运行中 0.2.2-alpha.3', current.status ?? '')
check('restarted process: no restart action', current.action === null, current.action ?? '')

// The page heading carries the plugin's own version, which only the Host can
// read (it owns package.json), so it arrives with the list payload.
const manifestVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const titled = render({
  ...inventoryFor('0.2.2-alpha.3'),
  runtime: { ...inventoryFor('0.2.2-alpha.3').runtime, pluginVersion: manifestVersion },
})
check('panel title: names the plugin and its version', titled.title === `版本管理 ${manifestVersion}`, titled.title ?? '')
check('panel title: works without a Host version', current.title === '版本管理', current.title ?? '')

const upgrading = render(inventoryFor('0.2.2-alpha.2'), { kind: 'upgrade', version: '0.2.2-alpha.4', restart: true })
check('upgrade overlay: title names the target', upgrading.dialogTitle === '正在升级到 0.2.2-alpha.4', upgrading.dialogTitle ?? '')
check(
  'upgrade overlay: explains the automatic restart',
  upgrading.dialogLines.some((line) => line.includes('安装成功后将自动关闭旧服务并启动新版本')),
  upgrading.dialogLines.join(' | '),
)
check('upgrade overlay: shows a working indicator', upgrading.dialogStatus === '升级进行中…', upgrading.dialogStatus ?? '')

const installing = render(inventoryFor('0.2.2-alpha.2'), { kind: 'upgrade', version: '0.2.2-alpha.4', restart: false })
check(
  'upgrade overlay: a non-running area does not promise a restart',
  installing.dialogLines.some((line) => line.includes('可在需要时重启')),
  installing.dialogLines.join(' | '),
)

// The Host keeps installing after the page that started it is reloaded, so the
// panel rebuilds its blocked state from `runtime.upgrading` alone.
const hostInstalling = render(inventoryFor('0.2.2-alpha.2', { target: 'npx', version: '0.2.1-rc.5', startedAt: 0 }))
check('host upgrade: overlay names the target', hostInstalling.dialogTitle === '正在升级到 0.2.1-rc.5', hostInstalling.dialogTitle ?? '')
check(
  'host upgrade: overlay says another page started it',
  hostInstalling.dialogLines.some((line) => line.includes('由另一个页面发起')),
  hostInstalling.dialogLines.join(' | '),
)
check(
  'host upgrade: the toolbar restart stays disabled',
  hostInstalling.restartButton !== null && hostInstalling.restartButton.props.disabled === true,
  hostInstalling.restartButton === null ? 'missing' : String(hostInstalling.restartButton.props.disabled),
)
check(
  'host upgrade: the channel row reports the running install',
  hostInstalling.buttons.some((entry) => typeof entry.text === 'string' && entry.text.includes('升级中')),
  JSON.stringify(hostInstalling.buttons),
)

const desktopNewer = render(
  inventoryFor('0.2.2-alpha.3'),
  null,
  { supported: true, installed: { version: '0.2.2-rc.1' }, publishedVersion: '0.2.2-rc.2' },
  {},
  'desktop',
)
check(
  'desktop page: status names installed and latest',
  desktopNewer.status === '已安装 0.2.2-rc.1 · 最新版本 0.2.2-rc.2',
  desktopNewer.status ?? '',
)
check('desktop page: latest version badge', desktopNewer.latestBadge === '最新版本 0.2.2-rc.2', desktopNewer.latestBadge ?? '')
check('desktop page: newer version offers upgrade', desktopNewer.upgradeButton !== null, desktopNewer.upgradeButton === null ? JSON.stringify(desktopNewer.buttons) : 'present')
check('desktop page: newer version lights its tab dot', desktopNewer.desktopDot === true)

const desktopSame = render(
  inventoryFor('0.2.2-alpha.3'),
  null,
  { supported: true, installed: { version: '0.2.2-rc.2' }, publishedVersion: '0.2.2-rc.2' },
  {},
  'desktop',
)
check('desktop page: same version stays quiet', desktopSame.desktopDot === false)
check('desktop page: same version shows install rather than upgrade', desktopSame.upgradeButton === null)

const desktopSeen = render(
  inventoryFor('0.2.2-alpha.3'),
  null,
  { supported: true, installed: { version: '0.2.2-rc.1' }, publishedVersion: '0.2.2-rc.2' },
  { desktop: '0.2.2-rc.2' },
  'desktop',
)
check('desktop page: acknowledged version stays quiet', desktopSeen.desktopDot === false)

const desktopMissing = render(
  inventoryFor('0.2.2-alpha.3'),
  null,
  { supported: true, installed: null, publishedVersion: '0.2.2-rc.2' },
  {},
  'desktop',
)
check(
  'desktop page: latest version is shown even when not installed',
  desktopMissing.status === '桌面版未安装 · 最新版本 0.2.2-rc.2',
  desktopMissing.status ?? '',
)

/* Delete and cache clean ------------------------------------------------ */

// A confirm dialog without `kind` fell through to the upgrade branch, which
// posted `{}` to /dsh-versions/upgrade and answered "invalid-target" — the
// "undefined 升级失败：invalid-target" a 1.0.0 user saw while cleaning the npx
// cache. Each confirm must reach its own route.
const orphan = { ...baseRow('0.2.2-alpha.1', false), installed: false, latest: false }
const withOrphan = { ...inventoryFor('0.2.2-alpha.2'), rows: [...inventoryFor('0.2.2-alpha.2').rows, orphan] }
const orphanPanel = render(withOrphan)
const cleanAllButton = orphanPanel.buttons.find((entry) => entry.text === '全部清理')
const rowCleanButton = orphanPanel.buttons.find((entry) => entry.text === '清理缓存')
check('cache clean: the group action is offered', cleanAllButton !== undefined, JSON.stringify(orphanPanel.buttons.map((entry) => entry.text)))
check('cache clean: the row action is offered', rowCleanButton !== undefined)

const pendingFrom = async (button) => {
  setters = []
  await button?.node.props.onClick?.()
  return setters.find((value) => value !== null && typeof value === 'object' && Array.isArray(value.versions))
}

const cleanPlan = await pendingFrom(cleanAllButton)
check('cache clean: the group confirmation is a delete', cleanPlan?.kind === 'delete', JSON.stringify(cleanPlan))
const rowPlan = await pendingFrom(rowCleanButton)
check('cache clean: the row confirmation is a delete', rowPlan?.kind === 'delete', JSON.stringify(rowPlan))

const confirming = render(withOrphan, null, null, {}, null, cleanPlan)
requests = []
await confirming.confirmButton?.props.onClick?.()
await settle(60)
const confirmUrls = requests.map((entry) => entry.url)
check(
  'cache clean: confirming posts to the delete route',
  confirmUrls.includes('/dsh-versions/delete') && !confirmUrls.includes('/dsh-versions/upgrade'),
  confirmUrls.join(', ') || 'no request',
)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall status checks passed')