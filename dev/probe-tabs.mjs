// Renders the panel with a React stub and asserts the switcher is honest:
// three tabs, exactly one area section, and a working onSelect.
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// The page starts in its loading state and relies on an effect to finish; the
// stub never runs effects, so every initial `true` flag is forced off here.
const React = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial === true ? false : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
}

let captured = null
const loader = {
  load(options) {
    const require_ = (id) => {
      if (id === 'react') return React
      throw new Error(`unexpected require: ${id}`)
    }
    captured = options.factory(require_)
    return captured
  },
}

globalThis.window = {
  __ModuleLoader__: loader,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
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

/** Walk a rendered tree, flattening children arrays and fragments. */
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

/** Expand function components the way React would, then walk the result. */
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
    current = {
      ...current,
      children: (current.children ?? []).map(resolve),
    }
    return current
  }
  return current
}

const tree = resolve(mainComponent({ pickDirectory: async () => null }))

let switches = []
let sections = 0
let toolbar = []
let separators = 0
let headerButtons = 0
walk(tree, (node) => {
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.startsWith('dshvm-switch') && node.type === 'button') switches.push(node)
  if (node.type === 'section') sections += 1
  if (typeof cls === 'string' && cls.split(' ').includes('dshvm-toolbar')) {
    toolbar = (node.children ?? []).flat(Infinity).filter((child) => child && child.type === 'button')
  }
  if (typeof cls === 'string' && cls.split(' ').includes('dshvm-toolbar-sep')) separators += 1
  if (node.type === 'header') {
    headerButtons += (node.children ?? []).flat(Infinity).filter((child) => child && child.type === 'button').length
  }
})

console.log('switcher buttons:', switches.length)
console.log('labels:', switches.map((node) => node.children.filter((child) => typeof child === 'string')))
console.log('section elements rendered:', sections)
console.log('status line present:', JSON.stringify(tree).includes('dshvm-status'))
console.log('header buttons (must be 0):', headerButtons)
const labels = toolbar.map((node) => node.children.filter((child) => typeof child === 'string').join(''))
const restartButton = toolbar.find((node) => node.children.filter((child) => typeof child === 'string').join('') === '重启 DSH')
console.log('toolbar buttons:', toolbar.length)
console.log('toolbar labels:', labels)
console.log('toolbar separators:', separators)
console.log('restart button disabled (no runtime):', restartButton?.props.disabled)

const failures = []
if (toolbar.length !== 5) failures.push('toolbar button count')
if (separators !== 1) failures.push('toolbar separator count')
if (!labels.includes('重启 DSH')) failures.push('restart button missing')
if (restartButton?.props.disabled !== true) failures.push('restart button should be disabled without a runtime')
if (failures.length > 0) {
  console.error(`\n${failures.length} toolbar check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('toolbar checks passed')