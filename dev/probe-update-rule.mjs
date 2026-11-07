// Mirrors the client's hasUpdate / isUpgradeFor logic to check the real case:
// installed npx: 0.2.2-alpha.2 + 0.2.1-rc.3; registry: rc 0.2.1-rc.5, alpha 0.2.2-alpha.2.
function compareVersions(left, right) {
  const parse = (value) => {
    const core = String(value ?? '').trim().replace(/^v/, '').split('+')[0]
    const dash = core.indexOf('-')
    return {
      main: (dash === -1 ? core : core.slice(0, dash)).split('.').map((part) => Number.parseInt(part, 10) || 0),
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

function newestOf(versions) {
  let newest = null
  for (const version of versions) if (newest === null || compareVersions(version, newest) > 0) newest = version
  return newest
}

function isUpgradeFor(versions, published) {
  if (typeof published !== 'string' || versions.length === 0) return false
  return compareVersions(published, newestOf(versions)) > 0
}

function hasUpdate(areas, registry) {
  if (registry?.ok !== true) return false
  const published = [registry.rc, registry.alpha].filter((v) => typeof v === 'string')
  if (published.length === 0) return false
  return areas.some((versions) => published.some((version) => isUpgradeFor(versions, version)))
}

// The row button is per channel: an rc newer than the installed rc is offered
// even though a newer alpha sits in the same area.
function isChannelUpgrade(versions, published, channelOf) {
  const sameChannel = versions.filter((version) => channelOf(version) === channelOf(published))
  if (sameChannel.length === 0) return versions.length === 0
  return compareVersions(published, newestOf(sameChannel)) > 0
}

const channelOf = (version) => (/-rc/.test(version) ? 'rc' : /-alpha/.test(version) ? 'alpha' : 'stable')

const npx = ['0.2.2-alpha.2', '0.2.1-rc.3']
const registry = { ok: true, rc: '0.2.1-rc.5', alpha: '0.2.2-alpha.2' }

console.log('badge now (must be false):', hasUpdate([[], npx], registry))
console.log('rc row upgrade (must be true):', isChannelUpgrade(npx, '0.2.1-rc.5', channelOf))
console.log('alpha row upgrade (must be false):', isChannelUpgrade(npx, '0.2.2-alpha.2', channelOf))

// Sanity: a genuinely newer publication still counts.
console.log('newer alpha detected (must be true):', hasUpdate([[], npx], { ok: true, rc: null, alpha: '0.2.3-alpha.1' }))
console.log('older rc vs installed alpha (must be false):', hasUpdate([[], npx], { ok: true, rc: '0.2.1-rc.9', alpha: null }))
// No installs: no badge.
console.log('nothing installed (must be false):', hasUpdate([[], []], registry))