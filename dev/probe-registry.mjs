const REGISTRY = process.env.DSHVM_REGISTRY ?? 'https://registry.npmjs.org'

const started = Date.now()
const response = await fetch(`${REGISTRY}/@deepseek-ai%2fdsh`, {
  headers: { accept: 'application/vnd.npm.install-v1+json' },
})
const body = await response.json()
const versions = Object.keys(body.versions ?? {})

function compare(left, right) {
  const parse = (value) => {
    const core = String(value).split('+')[0]
    const dash = core.indexOf('-')
    return {
      main: (dash === -1 ? core : core.slice(0, dash)).split('.').map(Number),
      pre: dash === -1 ? [] : core.slice(dash + 1).split('.'),
    }
  }
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < 3; i += 1) {
    const delta = (a.main[i] ?? 0) - (b.main[i] ?? 0)
    if (delta !== 0) return delta
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta
    } else if (xn) return -1
    else if (yn) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

const rc = versions.filter((v) => /-rc(?:[.-]|$)/i.test(v)).sort(compare).at(-1)
const alpha = versions.filter((v) => /-alpha(?:[.-]|$)/i.test(v)).sort(compare).at(-1)

console.log('ms:', Date.now() - started, 'status:', response.status, 'versions:', versions.length)
console.log('dist-tags:', body['dist-tags'])
console.log('rc:', rc, 'alpha:', alpha)
console.log('last 8:', versions.slice(-8))