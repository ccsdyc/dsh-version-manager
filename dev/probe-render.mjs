// Loads client.js with a tiny React stub and renders the panel once, so an
// undefined symbol in the render path throws here instead of in the browser.
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let captured = null
const React = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
}

const module_ = { exports: {} }
const loader = {
  load(options) {
    if (typeof options?.factory !== 'function') throw new Error('load() called without a factory')
    const require_ = (id) => {
      if (id === 'react') return React
      throw new Error(`unexpected require: ${id}`)
    }
    captured = options.factory(require_)
    return captured
  },
}

// The bundle registers itself through window.__ModuleLoader__.
globalThis.window = {
  __ModuleLoader__: loader,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms ?? 0, 0)),
  clearTimeout: (id) => clearTimeout(id),
}
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.document = { createElement: () => ({ set textContent(v) {}, textContent: '' }), head: { appendChild() {} }, querySelector: () => null }
globalThis.__ModuleLoader__ = loader

const exports = new Function('window', 'localStorage', 'document', '__ModuleLoader__', source)(
  globalThis.window,
  globalThis.localStorage,
  globalThis.document,
  loader,
)
// The bundle has no top-level export; the factory result is what matters.
const api = captured ?? exports

console.log('api keys:', Object.keys(api ?? {}))

const ctx = {
  slots: {
    inject: (name, fn) => {
      fn()
      return () => {}
    },
    register: (options, Component) => {
      console.log('registered slot:', options.name, '| id/key:', options.id ?? options.key)
      if (options.name === 'main') captured = { Component, options }
      return () => {}
    },
  },
  effect: (fn) => {
    fn()
    return () => {}
  },
  get: () => undefined,
}

if (typeof api?.apply !== 'function') {
  console.log('no apply export; keys were', Object.keys(api ?? {}))
  process.exit(1)
}

try {
  api.apply(ctx)
} catch (error) {
  console.log('apply threw:', String(error?.message ?? error))
  process.exit(1)
}

if (captured?.Component === undefined) {
  console.log('main component not captured')
  process.exit(1)
}

const props = { pickDirectory: async () => null }
try {
  const tree = captured.Component({ ...props })
  const text = JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value)).slice(0, 300)
  console.log('rendered ok, first 300 chars:', text)
} catch (error) {
  console.log('render threw:', String(error?.message ?? error))
  process.exit(1)
}