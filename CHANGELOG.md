# Changelog

All notable changes to this plugin are documented here. The format follows
Keep a Changelog, and versions follow Semantic Versioning.

## [1.1.0] - 2026-11-21

### Added

- A Chinese README (`README.zh.md`) next to the English one, both shipping in
  the package; the two link to each other.
- The panel heading shows the plugin's version after its name. The Host reads it
  from its own `package.json` and sends it with the list payload
  (`runtime.pluginVersion`), so it never goes stale against the installed copy.

### Changed

- Package, directory, loader entry, client module id, data folders and docs
  renamed from `dsh-version-manager` to `dsh-update-manager`: the npm name
  belongs to an unrelated package. The Chinese panel name stays 版本管理, and the
  HTTP routes stay under `/dsh-versions/`.

### Fixed

- A restart that raced an upgrade no longer boots a half-written install. A
  0.2.2-rc.5 upgrade failed to come back because `npm install --global` writes
  the launcher before the dependency tree, so the relaunched process died with
  `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-app-boot` while npm was still
  unpacking. `restartVersion` now refuses while an upgrade is in flight
  (`error: 'upgrading'`), and `restartPlan` refuses a version whose declared
  dependencies are not all on disk yet (`error: 'install-incomplete'`).
- The panel keeps restart and upgrade disabled while the Host reports an
  install it started (`runtime.upgrading`), including after a page reload, and
  polls the list route until the install finishes instead of leaving a stale
  "not upgrading" state.
- The restart helper retries a failed launch with a growing backoff for up to
  two minutes (1, 2, 4, 8, 15, then 30 s) instead of four attempts about twelve
  seconds apart, and logs `giving up` when the budget is spent.
- Confirming a delete or cache-clean dialog reached the delete route instead of
  the upgrade route. `askDelete`/`askCleanAll` built the pending plan without
  `kind`, so the dialog's confirm fell through to
  `performUpgrade(undefined, undefined)` and the panel answered
  `undefined 升级失败：invalid-target` for a request that carried no target at
  all. Both plans now carry `kind: 'delete'`, and a probe clicks through the
  dialog and asserts the delete route.

## [1.0.0] - 2026-11-07

### Added

- npm and npx DSH version inventory, rc/alpha channels, install sizes, and
  safe version deletion.
- One-click upgrade and restart-on-version flow for the running DSH service.
- Desktop client area for Windows and macOS, including installer discovery,
  installed-version detection, and published-version display.
- Desktop release updates detected from the installer's `Content-Disposition`
  version, with the same tab dot and sidebar `new` marker as npm/npx.
- Desktop shortcut creation for Windows `.lnk` and macOS `.app`/`.command`.
- Offline zip installer (`install.cmd` / `install.sh`) and npm package
  distribution.
- Donation QR / PayPal dialog, bilingual UI, and a self-hosted plugin-market
  index generator.

### Fixed

- Rewriting the Desktop shortcut now sends a per-item
  `SHChangeNotify(SHCNE_UPDATEITEM)`, so Explorer re-reads the icon instead of
  keeping the stale generic icon cached for that same-name `.lnk`.
- The shortcut uses the original `assets/tray.ico`, rebuilt from the supplied
  `icon.png` / `tray.ico` artwork as a multi-size icon (BMP frames plus a
  256 px PNG). The redundant web-derived `assets/dsh.ico` is gone.
- The Host copies the icon to `%LOCALAPPDATA%\dsh-update-manager\shortcut.ico`
  before writing the shortcut. Explorer refuses icons carrying the workspace's
  low integrity label, so pointing `IconLocation` at the packaged file produced
  the generic white-page icon even though the file and `IconLocation` were valid.
