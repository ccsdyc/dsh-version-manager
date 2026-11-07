import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function dictKeys(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`no ${name}`)
  const end = source.indexOf('\n    }', start)
  const body = source.slice(start, end)
  return new Set(
    [...body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_][\w.]*))\s*:/gm)].map((match) => match[1] ?? match[2]),
  )
}

const zh = dictKeys('zh')
const en = dictKeys('en')
const used = new Set([...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]))

console.log({ usedCount: used.size, zh: zh.size, en: en.size })
console.log('missing zh:', [...used].filter((key) => !zh.has(key)))
console.log('missing en:', [...used].filter((key) => !en.has(key)))
console.log('zh-only:', [...zh].filter((key) => !en.has(key)))
console.log('en-only:', [...en].filter((key) => !zh.has(key)))
console.log('unused:', [...zh].filter((key) => !used.has(key)))