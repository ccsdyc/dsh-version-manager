# Changelog

All notable changes to this plugin are documented here. The format follows
Keep a Changelog, and versions follow Semantic Versioning.

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
- The Host copies the icon to `%LOCALAPPDATA%\dsh-version-manager\shortcut.ico`
  before writing the shortcut. Explorer refuses icons carrying the workspace's
  low integrity label, so pointing `IconLocation` at the packaged file produced
  the generic white-page icon even though the file and `IconLocation` were valid.
