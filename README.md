# dsh version manager

A Harness bundle that adds a **版本管理 / Versions** entry to the left navigation
and a panel with three areas behind a segmented switcher. Only the open area is
rendered; a single status line under the switcher describes what that area runs
and what it has installed. The area this process runs from comes first; the
remaining areas default to npm, npx, desktop:

- **npm** — the globally installed dsh (`npm install -g`), upgradeable but never
  deletable.
- **npx** — the npx cache installs, listing the newest rc and alpha first, then
  every other installed version, which can be upgraded or deleted.
- **desktop** — the official desktop client: its installed version (read from the
  Windows uninstall registry), the published version parsed from the installer
  file name, the installer facts, and a one-click install/upgrade.

The status line separates the version this process **runs** from what is merely
installed. The running version is read from the package that owns
`process.argv[1]` when the Host module loads — never from the newest copy on
disk. Because an npx upgrade installs side by side and leaves the current
process alone, the panel can say `running 0.2.2-alpha.2 · newest installed
0.2.2-alpha.3` and offer to restart onto the newer copy. The row badge
`running` follows the `_npx/<hash>` the process booted from.

Each CLI area shows two rows: the newest published **rc** and the newest published
**alpha**. Because npx installs do not overwrite each other, rc and alpha sit side
by side, so each row is judged against the newest installed version **of its own
channel** — an installed alpha never hides an rc that is newer than the installed
rc, and the rc row never reports the alpha version as its current one. The sidebar
`new` marker follows the red dots: it appears only while at least one area has an
unacknowledged update.

## Desktop client

The official installers are fixed URLs with no version in the file name:

- Windows: `https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe`
- macOS (Apple Silicon): `https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg`
- macOS (Intel): `https://download.deepseek.com/desktop/dsh-latest-macos-x64.dmg`

The panel shows the installed desktop build and the published version parsed
from the installer's `Content-Disposition` file name (the fixed URL itself has no
version), plus the installer's size and release date from a `HEAD` request.
Windows and the Apple Silicon DMG return a versioned file name; the current Intel
x64 DMG returns no `Content-Disposition`, so that platform shows “latest version
unavailable” and does not light an update dot. The check is platform-neutral: if
the x64 artifact starts returning the header, the next check picks up its
version and the dot/UI work without a code change. Windows reads the uninstall
registry (`DisplayName` matching DeepSeek/dsh); macOS reads the
`CFBundleShortVersionString` of `DeepSeek*.app` bundles in `/Applications` and
`~/Applications`, using `plutil` for a binary plist. An x64 node running under
Rosetta still selects the ARM64 disk image, because the machine is ARM64. A
published version newer than the installed one lights the desktop tab and the
sidebar `new` marker; opening the desktop tab acknowledges that published
version.

Installing is deliberately two-step and never silent:

1. The panel asks the user to pick a folder through the Host-native directory
   picker. Cancelling stops the flow before anything is downloaded.
2. The Host downloads the official installer into that folder, then launches it
   so the user drives the installer UI. On macOS `open` mounts the `.dmg` for
   the user to drag the app into `/Applications`.

Only `download.deepseek.com` is accepted, and only the fixed URL above is used —
the browser cannot supply a download target. A failed download deletes its
partial file.

## Desktop shortcut

The toolbar's **桌面快捷方式 / Desktop shortcut** button writes a launcher to
the user's Desktop. It follows **how this session was started**, not which
client happens to be installed: a machine with the desktop exe installed but
running from npx gets an npx launcher. Detection reads the process arguments
(`_npx/<hash>` marks an npx run, an Electron runtime marks the desktop app,
a path under a global `node_modules` root marks npm); the remaining kinds are
fallbacks when the running install cannot be reached:

1. the kind that started this process,
2. then the desktop client,
3. then the global npm install,
4. then an installed npx copy, preferring the directory this process runs from.

On Windows the launcher is `DeepSeek Harness.lnk`, targeting the desktop exe,
the global `%APPDATA%\npm\dsh.cmd`, or an npx `.bin\dsh.cmd`. On macOS a CLI
install gets `DeepSeek Harness.command`, a `/bin/sh` script that execs the
current node with the install's `lib/bin.js` and the preserved profile
arguments; the desktop client gets a `DeepSeek Harness.app` symlink to the
installed bundle. A `.command` uses Terminal's icon; the app symlink keeps the
app's own icon.

On Windows the shortcut uses the original glossy `assets/tray.ico` shipped with
this plugin (override with `DSH_VERSION_MANAGER_ICON`). It was rebuilt from the
original `icon.png` / `tray.ico` artwork as a multi-size `.ico` (BMP frames plus
a 256 px PNG). Before writing the `.lnk`, the Host copies those bytes to
`%LOCALAPPDATA%\dsh-version-manager\shortcut.ico` and points `IconLocation`
there: the packaged copy sits under the DSH workspace, whose low integrity label
Explorer's shortcut icon extractor refuses, while the AppData copy renders. The
plugin directory is resolved from its own module URL, so a copy of the plugin on
another machine keeps the icon. When the source file is missing the shortcut
keeps the system icon.

Writing is idempotent: the same file is recreated on every click, so a shortcut
the user deleted comes back, and a different launch kind takes over the name. The
Host refuses when nothing is installed or when the Desktop folder is missing.
After saving the `.lnk` the Host asks the shell to re-read that exact item's icon
(`SHChangeNotify(SHCNE_UPDATEITEM)`): Explorer otherwise keeps the generic icon
it cached for a rewritten same-name shortcut and never re-extracts the `.ico`.

For a CLI launch the shortcut carries the running profile and launcher arguments
(the same `web` / `--profile` / `--patch` / app flags, minus `--no-open`), and
uses the server's working directory. On Windows a bare `dsh.cmd` exits with
`error: --profile <name> is required`, so a shortcut with no arguments never
started anything. The preferred target is PowerShell with `-NoExit`; the command
is base64-encoded (`-EncodedCommand`) so paths and arguments stay out of the
command-line quoting rules, and a startup error stays visible. When PowerShell
is absent the `.cmd` itself is the target and Windows runs it through cmd.exe.
The desktop client is still started directly from its exe.

The panel's action row sits below the title, so the heading keeps its own line:
re-check, desktop shortcut, and restart DSH; a divider, then the language and tip
buttons.

## Language

The panel picks its own language from the user's time zone: IANA zones belonging
to mainland China (`Asia/Shanghai`, `Asia/Chongqing`, `Asia/Harbin`,
`Asia/Urumqi`, `Asia/Kashgar`, `PRC`) get Chinese; every other zone — including
Hong Kong and Macau — gets English. It does not follow the application locale.

The header button labelled `English` / `中文` toggles the language. That manual
choice outranks the time-zone answer and is kept in `localStorage`, so it
survives reloads and restarts. The sidebar entry is re-registered on toggle so
its label follows immediately.

## Tip the developer

A button at the foot of the panel opens a dialog. The Chinese panel shows the
payment QR code shipped as `assets/dashang.jpg`; the Host serves it at
`/dsh-versions/tip-qrcode` and `TIP.qrcode` points at that same-origin route.
The English panel opens `https://paypal.me/ccsdyc` in a new tab through
`TIP.link`. PayPal's page refuses to be framed, so the dialog shows a button
rather than an iframe.

## Update marker

While an update is available, the sidebar entry gets a red **new** after its
label, and the matching segment in the area switcher gets a red dot. All three
areas compare a published version with the installed copy. npm and npx use the
newest registry rc/alpha; desktop parses the published version from the
installer's `Content-Disposition` file name. A check runs when the plugin loads
and then once at the top of every hour. Clicking the tab acknowledges the
published version, clears its dot, and drops the sidebar `new` when no
unacknowledged dot remains. Acknowledgements are kept in `localStorage` under
`dsh-version-manager:dismissed`; a newer published version lights the dot again.
The marker is one owned stylesheet keyed on the row's `aria-label`;
install/uninstall actions re-run the check immediately.

## What it scans

Every existing npm cache root is inspected (`npm_config_cache`,
`%LOCALAPPDATA%\npm-cache`, `%APPDATA%\npm-cache`, `~/.npm`):

- `_npx/<hash>/package.json` → the installed dsh version, directory footprint,
  and last-modified time of the install.
- `_cacache/index-v5` → every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*`
  tarball entry, aggregated per dsh version, including versions whose `_npx`
  directory the user deleted by hand (shown as **仅缓存 / cache only**).
- Globally installed `@deepseek-ai/dsh` packages are the npm area. Windows
  checks `%APPDATA%\npm\node_modules` and `%LOCALAPPDATA%\npm\node_modules`;
  macOS and Linux also check the running node's prefix
  (`<prefix>/lib/node_modules`), `/usr/local`, `~/.npm-global`, and the
  nvm/nodebrew/Volta/asdf/fnm version roots; macOS additionally checks
  `/opt/homebrew/lib/node_modules`.

## Latest versions

The published versions come from the configured npm registry (env
`npm_config_registry`, then `~/.npmrc`, then the public default), fetched with
the abbreviated packument and cached for five minutes. "Newest rc" and "newest
alpha" are the highest semver per channel, so they follow the registry rather
than `dist-tags`.

## Upgrading

- npm: `npm install --global @deepseek-ai/dsh@<version>`
- npx: `npx --yes @deepseek-ai/dsh@<version> --version` — this populates the
  npx cache and exits; it does not start a server and does not delete the old
  copy, which then appears under the other installed versions.

Both commands run with the running node's bin directory and the usual npm
locations prepended to `PATH`, so a desktop app launched from Finder on macOS
can still find a Homebrew or nvm npm.

While an install runs the panel shows a blocking overlay with the target
version and a spinner; a button caption alone reads as "nothing happened". The
overlay also says whether a restart follows.

Only one upgrade runs at a time, versions are validated against the registry
before they reach a shell, and each install is bounded to 15 minutes. The
response carries the command's output tail so failures are readable.

Upgrading the install this process runs from cannot take effect until the
process restarts, so the panel asks for confirmation before such an upgrade and
then restarts automatically. Upgrading the other area only installs a copy.

## Restarting

The panel offers a restart only for CLI launches (npx and npm) and only when the
launcher provided `ctx.appExit`; the desktop app is never restarted this way. The
toolbar's **Restart DSH** button restarts the running version the same way (it is
disabled for the desktop app), while the status line's `Restart on <version>`
action switches to a newer install. The Host:

1. spawns a detached helper with this process's PID, working directory, and
   launcher arguments;
2. answers the request, then calls the launcher's bounded exit
   (`ctx.appExit(0)`);
3. the helper waits for the PID to disappear (20 s grace, then it terminates
   it), waits one second, and launches the new install's
   `node_modules/@deepseek-ai/dsh/lib/bin.js` with the same arguments —
   `--no-open` is appended for the web profile so the restart does not open a
   second tab;
4. the page polls `/dsh-versions/list` and reloads only when the target version
   is reported by a new PID — a same-version restart must not reload on the old
   server's reply. After two minutes the overlay shows the log path instead.

The helper attempts the launch four times (a port still closing should not leave
the machine without a server) and appends its messages plus the new server's
output to `$DSH_HOME/logs/dsh-version-manager-restart.log` (macOS falls back to
`~/Library/Logs/dsh-version-manager/`, Windows to
`%LOCALAPPDATA%\dsh-version-manager\`). Sessions are
persisted, but agent turns and background jobs running at that moment are
interrupted.

## Install from npm

The package is published as `dsh-version-manager`. Use the plugin manager's
install action, or run:

```powershell
dsh plugin --profile web add dsh-version-manager
```

If the CLI only adds the dependency, enable the bundle in the plugin manager
before restarting. Restart DSH after installing or updating; the Host half is
loaded at boot and the client bundle is republished then.

## Protection rules

- The newest installed version never offers a delete button.
- The version the running process started from (detected from `process.argv`
  paths containing `_npx/<hash>`) never offers a delete button either.
- The npm area never offers delete at all.

## Deleting

- An install row removes its `_npx/<hash>` directory **and** its cache entries.
- A cache-only row removes only its cache entries.
- Cache removal deletes the matching index lines, then deletes a content blob
  only when no remaining index entry references that integrity (blobs are
  content-addressed and may be shared with unrelated packages). If an index
  file cannot be read or rewritten, blob collection is skipped entirely.
- Every action asks for confirmation first and reports the released bytes.

## Transport

The Host half registers these routes on the composition's `webServer`
(`/dsh-versions/list`, `/dsh-versions/sizes`, `/dsh-versions/registry`,
`/dsh-versions/upgrade`, `/dsh-versions/restart`, `/dsh-versions/delete`,
`/dsh-versions/desktop`, `/dsh-versions/desktop/install`,
`/dsh-versions/shortcut`, `/dsh-versions/tip-qrcode`), each behind
`connection.requestRejection`. The Client half calls them with same-origin `fetch`. `/list` also carries `runtime`
(kind, hash, booted version, PID, whether a restart is possible). The list is
returned before install sizes are measured; sizes arrive in a second request so
the panel paints in about a second even on a cold cache.

## Packaging and portability

The package is self-contained. `index.js` uses only Node built-ins, `client.js`
uses only the host-provided React loader, and `package.json` declares no npm
dependencies. Every runtime asset is inside the package and listed in `files`:
`assets/dashang.jpg`, `assets/tray.ico`, `icon.svg`,
`locale/*.json`, `cordis.patch.yml`, `LICENSE`, and `README.md`. The Host
resolves the tip QR and shortcut icon from its own module URL, so a copied or
packed directory works from any location. `dev/` and `tools/` are excluded from
the npm `files` list; a zip is a folder copy, so both are available there.

### Zip / offline install

Compress the `dsh-version-manager` folder with the folder itself at the zip
root. On the target machine:

1. Extract the folder anywhere, for example `D:\dsh\dsh-version-manager`.
2. Fully quit DSH.
3. Windows: double-click `install.cmd`; macOS/Linux: `sh install.sh`.
4. Restart DSH and refresh the page.

The installer locates `%DSH_HOME%` (or `~/.dsh`) and the `web` profile, finds
`dsh` on PATH or in the npx cache, runs
`dsh plugin --profile web add link:<folder>`, adds the bundle to the profile,
and creates the local package link. If no CLI is found it falls back to a direct
link; `--no-cli` forces that mode. Before editing, it backs up the profile's
`package.json` to `package.json.dshvm-backup`.

Options: `--profile <name>`, `--dsh <path>`, `--dry-run`, `--no-cli`.

A zip is transport, not a DSH install source; the installer is what registers
the folder in the target profile.

### Plugin market (npm source)

DSH plugin market format 1 accepts npm and Git versions, not zip files. The
package is published as `dsh-version-manager`; generate a self-hosted index
whose source is npm:

```powershell
node tools/make-market-index.mjs --version 1.0.0 --out market/index.json
```

The tool embeds `icon.svg` and the locale description and prints the
`dsh-version-manager@1.0.0` install spec. Put `index.json` on an HTTPS static
host and add that URL under DSH's plugin-market index settings.

For a commit-pinned Git release instead, add `--source git --repo
https://github.com/ccsdyc/dsh-version-manager --commit <40-sha>`; use
`--path <subdir>` when the plugin is not at the repository root.

The only runtime requirements are a compatible DSH host, the platform tools the
panel drives (`npm`/`npx`, PowerShell on Windows, `plutil`/`open` on macOS), and
network access for the registry and desktop-installer features.

## Development

- `dev/probe-delete.mjs` builds a synthetic cache root and asserts the deletion
  rules (shared blobs survive, latest is refused, installs are removed).
- `dev/probe-registry-logic.mjs` checks the registry answer and that upgrade
  rejects bad targets, unsafe version strings, and unpublished versions.
- `dev/probe-restart.mjs` checks the booted-version read, the launch plan, and
  the detached helper against two throwaway HTTP servers.
- `dev/probe-shortcut.mjs` checks the shortcut arguments, profile retention, and
  the PowerShell/command invocation builders.
- `dev/probe-macos.mjs` checks the macOS-only decisions on any host: global npm
  roots, launch classification, Info.plist parsing, the app-bundle scan, the
  `.command` script, installer architecture/Rosetta, PATH, and log paths.
- `dev/probe-status.mjs` renders the panel with a stale `.2` process, a `.3`
  install, and a running upgrade, and asserts the status line, the restart
  action, the upgrade overlay, and the desktop installed/latest versions and dot.
- `dev/probe-tip.mjs` mounts the Host on a fake web server and checks the tip QR
  route serves the shipped JPEG for GET and HEAD.
- `dev/probe-dots.mjs` mirrors the area update rule: npm/npx published versions
  plus the desktop published version, and the sidebar `new` following both.
- `dev/check-locales.mjs` checks `zh`/`en` key parity.

Host code is imported once per process, so **a changed `index.js` needs a DSH
restart** before the routes reflect it; a page refresh only reloads the browser
half.