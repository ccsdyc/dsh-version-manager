/**
 * Exercises deleteVersions against a synthetic npm cache root: an installed
 * version, a cache-only version whose tarball shares one content blob with an
 * unrelated package, and a protected latest version.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deleteVersions } from '../index.js'

const root = await mkdtemp(path.join(tmpdir(), 'dshvm-delete-'))

const sha = (label) => `sha512-${Buffer.from(label.padEnd(64, '.')).toString('base64')}`
const uniqueDigest = sha('unique-dsh-998')
const sharedDigest = sha('shared-with-other-package')
const installedDigest = sha('installed-dsh-997')

function blobPath(integrity) {
  const dash = integrity.indexOf('-')
  const hex = Buffer.from(integrity.slice(dash + 1), 'base64').toString('hex')
  return path.join(root, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4))
}

async function writeBlob(integrity, text) {
  const file = blobPath(integrity)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

function entry(key, integrity, size) {
  return `\t${JSON.stringify({ key, integrity, size, time: Date.now(), metadata: {} })}`
}

async function writeIndex(id, lines) {
  const file = path.join(root, '_cacache', 'index-v5', id.slice(0, 2), id.slice(2, 4), id.slice(4))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${lines.join('\n')}\n`)
  return file
}

const registry = 'http://127.0.0.1:1/repository/npm-public'
const url = (name, version) => `${registry}/@deepseek-ai/${name}/-/${name}-${version}.tgz`

// A live install of 9.9.7 and the protected latest 9.9.9.
for (const [hash, version] of [['aaaaaaaaaaaaaaaa', '9.9.7'], ['bbbbbbbbbbbbbbbb', '9.9.9']]) {
  const dir = path.join(root, '_npx', hash)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ _npx: { packages: [`@deepseek-ai/dsh@${version}`] } }))
  await writeFile(path.join(dir, 'payload.bin'), 'x'.repeat(2048))
}

// Cache: 9.9.7 (installed), 9.9.8 (cache only), an unrelated package sharing a blob.
const indexOne = await writeIndex('11111111111111111111111111111111', [
  entry(`make-fetch-happen:request-cache:${url('dsh', '9.9.8')}`, uniqueDigest, 100),
  entry(`make-fetch-happen:request-cache:${url('dsh', '9.9.8')}`, sharedDigest, 100),
  entry(`make-fetch-happen:request-cache:${url('dsh', '9.9.7')}`, installedDigest, 200),
  entry('make-fetch-happen:request-cache:http://127.0.0.1:1/repository/npm-public/other-pkg', sharedDigest, 50),
])
const indexTwo = await writeIndex('22222222222222222222222222222222', [
  entry(`make-fetch-happen:request-cache:${url('dsh-client-ui-x', '9.9.8')}`, sharedDigest, 100),
])

await writeBlob(uniqueDigest, 'unique')
await writeBlob(sharedDigest, 'shared')
await writeBlob(installedDigest, 'installed')

process.env.npm_config_cache = root

const before = {
  unique: existsSync(blobPath(uniqueDigest)),
  shared: existsSync(blobPath(sharedDigest)),
  installed: existsSync(blobPath(installedDigest)),
  blobBytes: (await stat(blobPath(uniqueDigest))).size,
}

// The latest version must be refused.
const guard = await deleteVersions({ versions: ['9.9.9'] })
console.log('guard:', JSON.stringify(guard))

// Cache-only cleanup: only 9.9.8 entries and its exclusive blob go.
const result = await deleteVersions({ mode: 'cache', versions: ['9.9.8'] })
console.log('delete 9.9.8:', JSON.stringify(result))

const afterOne = await readFile(indexOne, 'utf8')
const afterTwo = existsSync(indexTwo)
const report = {
  uniqueBlobDeleted: !existsSync(blobPath(uniqueDigest)),
  sharedBlobKept: existsSync(blobPath(sharedDigest)),
  installedBlobKept: existsSync(blobPath(installedDigest)),
  uniqueIndexLineGone: !afterOne.includes('dsh-9.9.8.tgz'),
  otherLineKept: afterOne.includes('other-pkg'),
  secondIndexFileGone: !afterTwo,
  installedEntriesKept: afterOne.includes('dsh-9.9.7.tgz') && existsSync(path.join(root, '_npx', 'aaaaaaaaaaaaaaaa')),
  latestStillInstalled: existsSync(path.join(root, '_npx', 'bbbbbbbbbbbbbbbb')),
  before,
}
console.log(JSON.stringify(report, null, 2))

// Deleting an installed version removes its directory and cache entry.
const second = await deleteVersions({ versions: ['9.9.7'] })
console.log('delete 9.9.7:', JSON.stringify(second))
console.log('installed dir gone:', !existsSync(path.join(root, '_npx', 'aaaaaaaaaaaaaaaa')))
console.log('installed blob gone:', !existsSync(blobPath(installedDigest)))
console.log('latest dir kept:', existsSync(path.join(root, '_npx', 'bbbbbbbbbbbbbbbb')))

const files = await readdir(root)
console.log('root entries:', files)

await rm(root, { recursive: true, force: true })