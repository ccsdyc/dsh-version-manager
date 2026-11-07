// Mirrors the panel's red-dot and sidebar `new` rule:
// npm/npx compare published versions; desktop compares the published version
// parsed from the installer's Content-Disposition with the installed version.
function parse(value) {
  const core = String(value ?? '').trim().replace(/^v/, '').split('+')[0]
  const dash = core.indexOf('-')
  return {
    main: (dash === -1 ? core : core.slice(0, dash)).split('.').map((part) => Number.parseInt(part, 10) || 0),
    pre: dash === -1 ? [] : core.slice(dash + 1).split('.'),
  }
}

function compareVersions(left, right) {
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

function desktopPublishedVersion(snapshot) {
  const value = snapshot?.publishedVersion
  return typeof value === 'string' && value !== '' ? value : null
}

function desktopInstalledVersion(snapshot) {
  const value = snapshot?.installed?.version
  return typeof value === 'string' && value !== '' ? value : null
}

function hasDesktopUpdate(dismissed, snapshot) {
  const published = desktopPublishedVersion(snapshot)
  const installed = desktopInstalledVersion(snapshot)
  if (published === null || installed === null) return false
  return compareVersions(published, installed) > 0 && dismissed.desktop !== published
}

function visibleUpdate(dismissed, snapshot, npm = false, npx = false) {
  return npm || npx || hasDesktopUpdate(dismissed, snapshot)
}

const installed = { version: '0.2.2-rc.1' }
const newer = { installed, publishedVersion: '0.2.2-rc.2' }
const same = { installed: { version: '0.2.2-rc.2' }, publishedVersion: '0.2.2-rc.2' }
const older = { installed: { version: '0.2.2-rc.2' }, publishedVersion: '0.2.2-rc.1' }
const checks = []
const check = (label, actual, expected) => {
  const ok = actual === expected
  checks.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

check('newer published version lights the dot', hasDesktopUpdate({}, newer), true)
check('same version stays quiet', hasDesktopUpdate({}, same), false)
check('older published version stays quiet', hasDesktopUpdate({}, older), false)
check('missing installed version stays quiet', hasDesktopUpdate({}, { publishedVersion: '0.2.2-rc.2' }), false)
check('missing published version stays quiet', hasDesktopUpdate({}, { installed }), false)
check('acknowledged published version clears the dot', hasDesktopUpdate({ desktop: '0.2.2-rc.2' }, newer), false)
check('prerelease numbers compare numerically', hasDesktopUpdate({}, { installed: { version: '0.2.2-rc.2' }, publishedVersion: '0.2.2-rc.10' }), true)
check('sidebar new follows the desktop version', visibleUpdate({}, newer), true)
check('sidebar new clears with the desktop dot', visibleUpdate({ desktop: '0.2.2-rc.2' }, newer), false)
check('CLI updates still keep the sidebar new', visibleUpdate({}, newer, true, false), true)

if (checks.some((ok) => !ok)) {
  console.error('desktop version checks failed')
  process.exit(1)
}
console.log('all desktop version checks passed')
