const REGISTRY = process.env.DSHVM_REGISTRY ?? 'https://registry.npmjs.org'
const candidates = [
  '@deepseek-ai/dsh-desktop',
  '@deepseek-ai/dsh-desktop-app',
  '@deepseek-ai/dsh-electron',
  '@deepseek-ai/dsh-client-desktop',
  '@deepseek-ai/dsh-app-desktop',
  '@deepseek-ai/dsh-gui',
]

for (const name of candidates) {
  const url = `${REGISTRY}/${name.replace('/', '%2f')}`
  try {
    const response = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
    if (response.ok) {
      const body = await response.json()
      console.log('FOUND', name, 'tags:', JSON.stringify(body['dist-tags']), 'versions:', Object.keys(body.versions ?? {}).length)
    } else {
      console.log('missing', name, response.status)
    }
  } catch (error) {
    console.log('error', name, String(error?.message ?? error))
  }
}

// Does the public registry know a desktop package?
try {
  const response = await fetch('https://registry.npmjs.org/-/v1/search?text=%40deepseek-ai%2Fdsh-desktop&size=5', {
    headers: { accept: 'application/json' },
  })
  console.log('npm search status:', response.status)
  if (response.ok) {
    const body = await response.json()
    console.log(JSON.stringify((body.objects ?? []).map((entry) => entry.package?.name)))
  }
} catch (error) {
  console.log('npm search failed:', String(error?.message ?? error))
}

// Release artifacts, if the repository publishes desktop builds.
try {
  const response = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-version-manager-probe' },
  })
  console.log('github latest release:', response.status)
  if (response.ok) {
    const body = await response.json()
    console.log('tag:', body.tag_name, 'name:', body.name)
    console.log('assets:', (body.assets ?? []).map((asset) => asset.name))
  } else {
    console.log((await response.text()).slice(0, 300))
  }
} catch (error) {
  console.log('github failed:', String(error?.message ?? error))
}