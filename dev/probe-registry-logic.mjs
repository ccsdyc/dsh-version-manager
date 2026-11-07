import { registrySnapshot, upgradeVersion } from '../index.js'

const registry = await registrySnapshot(true)
console.log('registry:', JSON.stringify({ ok: registry.ok, registry: registry.registry, rc: registry.rc, alpha: registry.alpha, tags: registry.tags, error: registry.error }))

// Nothing below may touch the machine: every call is rejected before spawning.
console.log('bad target:', JSON.stringify(await upgradeVersion({ target: 'brew', version: '1.0.0' })))
console.log('bad version:', JSON.stringify(await upgradeVersion({ target: 'npm', version: '1.0.0 && whoami' })))
console.log('unknown version:', JSON.stringify(await upgradeVersion({ target: 'npm', version: '9.9.9' })))