// Exercises installDesktop's guards without downloading the full installer,
// and checks the published version parsed from the installer's disposition.
const mod = await import('../index.js')

const cases = [
  ['no directory', {}],
  ['relative path', { directory: 'relative/dir' }],
  ['absolute but missing', { directory: 'C:\\definitely-not-here-9f8a7b6c' }],
  ['file instead of dir', { directory: new URL('../package.json', import.meta.url).pathname.replace(/^\//, '') }],
]

for (const [label, input] of cases) {
  try {
    const result = await mod.installDesktop(input)
    console.log(label, '->', JSON.stringify(result))
  } catch (error) {
    console.log(label, '-> threw', String(error?.message ?? error))
  }
}

const samples = [
  ['attachment; filename="deepseek-harness-0.2.2-rc.1-win-x64.exe"', 'deepseek-harness-0.2.2-rc.1-win-x64.exe', '0.2.2-rc.1'],
  ["attachment; filename*=UTF-8''deepseek-harness-0.2.2-alpha.2-win-x64.exe", 'deepseek-harness-0.2.2-alpha.2-win-x64.exe', '0.2.2-alpha.2'],
  ['attachment; filename="deepseek-harness-0.2.2-rc.1-mac-arm64.dmg"', 'deepseek-harness-0.2.2-rc.1-mac-arm64.dmg', '0.2.2-rc.1'],
  ['attachment; filename="deepseek-harness-0.2.2-rc.1-mac-x64.dmg"', 'deepseek-harness-0.2.2-rc.1-mac-x64.dmg', '0.2.2-rc.1'],
  ['attachment; filename="deepseek-harness-0.3.0-win-x64.exe"', 'deepseek-harness-0.3.0-win-x64.exe', '0.3.0'],
  ['attachment; filename="deepseek-harness-0.3.0-mac-arm64.dmg"', 'deepseek-harness-0.3.0-mac-arm64.dmg', '0.3.0'],
  ['attachment; filename="dsh-latest-macos-x64.dmg"', 'dsh-latest-macos-x64.dmg', null],
]
let failures = 0
for (const [header, expectedName, expectedVersion] of samples) {
  const name = mod.installerFileNameFromDisposition(header)
  const version = mod.installerVersionFromFileName(name)
  const ok = name === expectedName && version === expectedVersion
  console.log(`${ok ? 'ok  ' : 'FAIL'} disposition ${JSON.stringify(header)} -> ${name} / ${version}`)
  if (!ok) failures += 1
}

// The snapshot must stay cheap and truthful on this machine.
const snapshot = await mod.desktopSnapshot()
console.log('snapshot:', JSON.stringify({
  supported: snapshot.supported,
  platform: snapshot.platform,
  reachable: snapshot.reachable,
  sizeMB: Math.round((snapshot.size ?? 0) / 1048576),
  modified: snapshot.modified,
  modifiedValid: Number.isFinite(Date.parse(snapshot.modified ?? '')),
  publishedFileName: snapshot.publishedFileName,
  publishedVersion: snapshot.publishedVersion,
  versionValid: /^\d+\.\d+\.\d+/.test(snapshot.publishedVersion ?? ''),
  installed: snapshot.installed,
}))
if (snapshot.reachable && !/^\d+\.\d+\.\d+/.test(snapshot.publishedVersion ?? '')) {
  console.error('reachable installer has no parsable published version')
  failures += 1
}

if (failures > 0) {
  console.error(`${failures} desktop check(s) failed`)
  process.exit(1)
}
console.log('all desktop checks passed')
