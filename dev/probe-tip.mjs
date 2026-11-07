/**
 * Probe for the tip QR route: mounts the Host half on a fake web server, then
 * calls the registered handler with GET and HEAD and checks the real JPEG.
 */
import { readFileSync } from 'node:fs'
import { apply, inject } from '../index.js'

const failures = []
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(name)
}

check('inject includes webServer and connection', inject.includes('webServer') && inject.includes('connection'))

const routes = new Map()
const ctx = {
  connection: { requestRejection: () => undefined },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  effect: (fn) => {
    fn()
    return () => {}
  },
  get: () => undefined,
}
apply(ctx)

const route = routes.get('/dsh-versions/tip-qrcode')
check('tip route is registered', route !== undefined)
check('tip route is exact GET/HEAD', route?.kind === 'exact')

const response = () => ({
  statusCode: 0,
  headers: {},
  body: null,
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value
  },
  end(data) {
    this.body = data === undefined || data === null ? null : Buffer.from(data)
  },
})

const expected = readFileSync(new URL('../assets/dashang.jpg', import.meta.url))
const get = response()
await route.handler({ method: 'GET', headers: {} }, get)
check('GET returns 200', get.statusCode === 200, String(get.statusCode))
check('GET serves image/jpeg', get.headers['content-type'] === 'image/jpeg', get.headers['content-type'] ?? '')
check('GET returns the shipped JPEG', get.body !== null && get.body.length === expected.length && get.body.equals(expected), String(get.body?.length ?? 0))
check('GET payload starts like a JPEG', get.body !== null && get.body[0] === 0xff && get.body[1] === 0xd8)

const head = response()
await route.handler({ method: 'HEAD', headers: {} }, head)
check('HEAD returns 200 without a body', head.statusCode === 200 && head.body === null, String(head.statusCode))
check('HEAD reports the JPEG length', Number(head.headers['content-length']) === expected.length, String(head.headers['content-length']))

const wrongMethod = response()
await route.handler({ method: 'POST', headers: {} }, wrongMethod)
check('POST is rejected', wrongMethod.statusCode === 405, String(wrongMethod.statusCode))

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall tip-qrcode checks passed')