/**
 * Browser half of the version manager: one navigation entry in the sidebar
 * panel list and the page it opens. The page shows the npm (global) area and
 * the npx area, each with the newest rc and alpha published to the registry,
 * then the other installed npx versions. Upgrades and deletions are Host
 * operations reached over same-origin HTTP.
 *
 * @module dsh-version-manager/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-version-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace registered with the Client locale service. */
    const NS = 'dsh-version-manager'
    /** Sidebar panel id; the same value is the key of the `main` registration. */
    const PANEL_ID = 'dsh-versions'
    /** Host routes served by this package's Host half. */
    const LIST_URL = '/dsh-versions/list'
    const SIZES_URL = '/dsh-versions/sizes'
    const REGISTRY_URL = '/dsh-versions/registry'
    const UPGRADE_URL = '/dsh-versions/upgrade'
    const RESTART_URL = '/dsh-versions/restart'
    const DELETE_URL = '/dsh-versions/delete'
    const DESKTOP_URL = '/dsh-versions/desktop'
    const DESKTOP_INSTALL_URL = '/dsh-versions/desktop/install'
    const SHORTCUT_URL = '/dsh-versions/shortcut'
    /**
     * 打赏素材 / tip assets. `qrcode` is the Chinese payment QR served by this
     * plugin at /dsh-versions/tip-qrcode (assets/dashang.jpg); `link` is the
     * English PayPal target, opened in a new tab.
     */
    const TIP = { qrcode: '/dsh-versions/tip-qrcode', link: 'https://paypal.me/ccsdyc' }
    /** rc and alpha prerelease markers, matching the Host's selection. */
    const RC_VERSION = /-rc(?:[.-]|$)/i
    const ALPHA_VERSION = /-alpha(?:[.-]|$)/i

    const zh = {
      panel: '版本管理',
      title: '版本管理',
      subtitle: 'DSH安装版本管理、自动升级、桌面快捷方式、便捷重启。',
      refresh: '重新检查',
      'lang.switch': 'English',
      'lang.title': '切换界面语言（手动选择优先于时区判断）',
      loading: '正在扫描…',
      'channel.rc': '最新 rc',
      'channel.alpha': '最新 alpha',
      'section.npm': 'npm',
      'section.npx': 'npx',
      'section.desktop': '桌面版',
      'section.running': '运行中 {version}',
      'section.installed': '已安装 {version}',
      'section.newestInstalled': '最新安装 {version}',
      'section.missing': '未安装',
      'section.others': '其他已安装的 npx 版本',
      'section.roots': '已检查的目录',
      'area.npm': 'npm',
      'area.npx': 'npx',
      'area.desktop': '桌面版',
      'desktop.notInstalled': '桌面版未安装',
      'desktop.latest': '最新版本 {version}',
      'desktop.latestUnknown': '最新版本未获取',
      'desktop.size': '安装包 {size}',
      'desktop.released': '发布于 {date}',
      'desktop.install': '安装',
      'desktop.installing': '下载中…',
      'desktop.hint': '选择保存位置后下载官方安装包，下载完成会自动打开安装包。',
      'desktop.done': '已下载（{size}）并打开安装包',
      'desktop.failed': '下载失败：{reason}',
      'desktop.unsupported': '当前平台暂不提供桌面版',
      'desktop.unreachable': '下载地址当前无法访问，请检查网络或代理。',
      'desktop.noPicker': '当前环境不支持选择文件夹。',
      'shortcut.label': '桌面快捷方式',
      'shortcut.busy': '正在创建…',
      'shortcut.title': '在桌面生成一个可双击启动的图标（跟随当前启动方式）',
      'shortcut.done': '已在桌面创建：{path}',
      'shortcut.doneCommand': '已在桌面创建（未找到 PowerShell，改用命令行）：{path}',
      'shortcut.failed': '创建快捷方式失败：{reason}',
      'state.installed': '已安装',
      'state.missing': '未安装',
      'state.unpublished': '未发布',
      'row.newestInstalled': '{area} 最新安装 {version}',
      'action.upgrade': '升级',
      'action.install': '安装',
      'action.delete': '删除',
      'action.clean': '清理缓存',
      'action.cleanAll': '全部清理',
      'badge.latest': '最新版',
      'badge.running': '运行中',
      'badge.cacheOnly': '仅缓存',
      'row.install': '安装 {size}',
      'row.cache': '缓存 {size}',
      'row.lastUsed': '最后使用 {time}',
      'row.measuring': '正在统计占用…',
      'reclaimable': '可回收 {size}',
      'registry.loading': '正在查询 registry…',
      'registry.failed': '无法查询 registry：{message}',
      'registry.restart': '需要重启 DSH 进程才能加载最新版检查（Host 代码只在启动时载入）。',
      'registry.source': 'registry：{url}',
      'registry.hint': '只显示 registry 上最新的 rc 与 alpha；升级需要下载依赖，可能需要几分钟。',
      'upgrade.running': '升级中…',
      'busy.deleting': '删除中…',
      'upgrade.doneNpm': 'npm 已升级到 {version}。',
      'upgrade.doneNpx': 'npx 已安装 {version}。',
      'upgrade.failed': '{version} 升级失败：{message}',
      'upgrade.confirmRestartTitle': '升级到 {version} 并重启？',
      'upgrade.confirmRestartBody': '安装完成后会关闭当前服务并启动新版本；重启会中断正在进行中的任务。',
      'upgrade.confirmRestartOk': '升级并重启',
      'upgrade.dialogTitle': '正在升级到 {version}',
      'upgrade.dialogBody': '正在下载并安装依赖，可能需要几分钟，请保持此页面打开。',
      'upgrade.dialogAutoRestart': '安装成功后将自动关闭旧服务并启动新版本。',
      'upgrade.dialogNoRestart': '安装完成后，可在需要时重启以使用该版本。',
      'upgrade.dialogWorking': '升级进行中…',
      'restart.action': '重启到 {version}',
      'restart.now': '重启 DSH',
      'restart.nowTitle': '重启当前 DSH 服务？',
      'restart.nowBody': '当前服务会关闭并重新启动；正在进行中的任务会中断。',
      'restart.nowOk': '重启',
      'restart.nowHint': '重启当前 DSH 服务（会中断正在运行的任务）',
      'restart.unsupported': '当前启动方式不支持自动重启',
      'restart.confirmTitle': '重启到 {version}？',
      'restart.confirmBody': '当前服务会关闭，新版本启动后本页自动刷新；正在进行中的任务会中断。',
      'restart.confirmOk': '重启',
      'restart.title': '正在重启到 {version}',
      'restart.body': '旧服务正在关闭，新版本启动后本页会自动刷新。',
      'restart.failed': '等待新服务超时。请检查日志并手动启动：{log}',
      'restart.reload': '重新加载页面',
      'restart.requestFailed': '重启失败：{reason}',
      'restart.busy': '正在重启…',
      'confirm.title': '确认删除 {version}？',
      'confirm.body': '将删除该版本的安装目录与相关缓存，释放约 {size}。此操作不可撤销。',
      'confirm.bodyNoSize': '将删除 {version} 的安装目录与相关缓存。此操作不可撤销。',
      'confirm.cleanTitle': '清理缓存残留？',
      'confirm.cleanBody': '将清理 {count} 个版本的缓存条目，释放约 {size}。已安装的版本不受影响。',
      'confirm.cancel': '取消',
      'confirm.ok': '删除',
      'done.deleted': '已清理 {versions}，释放 {size}。',
      'done.cleaned': '已清理 {count} 个缓存残留版本，释放 {size}。',
      'refused.latest': '{version} 是最新版，未删除。',
      'refused.running': '{version} 正在运行，未删除。',
      'error.action': '操作失败：{message}',
      'error.scan': '扫描失败：{message}',
      'error.retry': '重试',
      'empty.orphan': '没有其他已安装的 npx 版本。',
      'note.protected': 'npm 区只提供升级，不提供删除；npx 区可删除旧版本，但最新版与正在运行的版本不可删除。',
      'tip.button': '打赏作者',
      'tip.title': '打赏作者',
      'tip.hint': '微信扫码，请作者喝杯咖啡，或给他的植发基金募捐一笔~',
      'tip.qrPlaceholder': '微信收款二维码\n待提供',
      'tip.linkPlaceholder': 'PayPal 链接待提供',
      'tip.openPaypal': '前往 PayPal',
      'roots.summary': '{npx} 个安装 · {versions} 个缓存版本 · {entries} 条缓存索引',
    }

    const en = {
      panel: 'Versions',
      title: 'Version manager',
      subtitle: 'DSH install management, automatic upgrades, desktop shortcuts, and quick restarts.',
      refresh: 'Check again',
      'lang.switch': '中文',
      'lang.title': 'Switch the panel language (manual choice takes precedence over the time zone)',
      loading: 'Scanning…',
      'channel.rc': 'Newest rc',
      'channel.alpha': 'Newest alpha',
      'section.npm': 'npm',
      'section.npx': 'npx',
      'section.desktop': 'Desktop',
      'section.running': 'running {version}',
      'section.installed': 'installed {version}',
      'section.newestInstalled': 'newest installed {version}',
      'section.missing': 'not installed',
      'section.others': 'Other installed npx versions',
      'section.roots': 'Directories checked',
      'area.npm': 'npm',
      'area.npx': 'npx',
      'area.desktop': 'Desktop',
      'desktop.notInstalled': 'Desktop app not installed',
      'desktop.latest': 'latest {version}',
      'desktop.latestUnknown': 'latest version unavailable',
      'desktop.size': 'installer {size}',
      'desktop.released': 'released {date}',
      'desktop.install': 'Install',
      'desktop.installing': 'Downloading…',
      'desktop.hint': 'Pick a folder; the official installer downloads there and opens automatically.',
      'desktop.done': 'Downloaded ({size}) and opened the installer',
      'desktop.failed': 'Download failed: {reason}',
      'desktop.unsupported': 'No desktop build for this platform',
      'desktop.unreachable': 'The download URL is unreachable; check the network or proxy.',
      'desktop.noPicker': 'This environment cannot pick a folder.',
      'shortcut.label': 'Desktop shortcut',
      'shortcut.busy': 'Creating…',
      'shortcut.title': 'Put a double-click launcher on the Desktop for the running install',
      'shortcut.done': 'Created on the Desktop: {path}',
      'shortcut.doneCommand': 'Created on the Desktop with the command line (PowerShell not found): {path}',
      'shortcut.failed': 'Could not create the shortcut: {reason}',
      'state.installed': 'Installed',
      'state.missing': 'Not installed',
      'state.unpublished': 'Not published',
      'row.newestInstalled': '{area} newest installed {version}',
      'action.upgrade': 'Upgrade',
      'action.install': 'Install',
      'action.delete': 'Delete',
      'action.clean': 'Clean cache',
      'action.cleanAll': 'Clean all',
      'badge.latest': 'Latest',
      'badge.running': 'Running',
      'badge.cacheOnly': 'Cache only',
      'row.install': 'install {size}',
      'row.cache': 'cache {size}',
      'row.lastUsed': 'last used {time}',
      'row.measuring': 'measuring footprint…',
      'reclaimable': 'reclaimable {size}',
      'registry.loading': 'Querying the registry…',
      'registry.failed': 'Registry query failed: {message}',
      'registry.restart': 'Restart the DSH process to load the version check — Host code is imported once at startup.',
      'registry.source': 'registry: {url}',
      'registry.hint': 'Only the newest rc and alpha on the registry are listed; an upgrade downloads dependencies and can take a few minutes.',
      'upgrade.running': 'Upgrading…',
      'busy.deleting': 'Deleting…',
      'upgrade.doneNpm': 'npm upgraded to {version}.',
      'upgrade.doneNpx': 'npx installed {version}.',
      'upgrade.failed': '{version} upgrade failed: {message}',
      'upgrade.confirmRestartTitle': 'Upgrade to {version} and restart?',
      'upgrade.confirmRestartBody': 'When the install finishes, the current service is closed and the new version is started. The restart interrupts any task that is still running.',
      'upgrade.confirmRestartOk': 'Upgrade and restart',
      'upgrade.dialogTitle': 'Upgrading to {version}',
      'upgrade.dialogBody': 'Downloading and installing dependencies; this can take a few minutes. Keep this page open.',
      'upgrade.dialogAutoRestart': 'When the install finishes, the old service closes and the new version starts automatically.',
      'upgrade.dialogNoRestart': 'Once installed, restart whenever you want to use this version.',
      'upgrade.dialogWorking': 'Upgrade in progress…',
      'restart.action': 'Restart on {version}',
      'restart.now': 'Restart dsh',
      'restart.nowTitle': 'Restart the current dsh service?',
      'restart.nowBody': 'The current service closes and starts again; tasks in progress are interrupted.',
      'restart.nowOk': 'Restart',
      'restart.nowHint': 'Restart the current dsh service (interrupts running tasks)',
      'restart.unsupported': 'This launch method cannot restart itself',
      'restart.confirmTitle': 'Restart on {version}?',
      'restart.confirmBody': 'The current service is closed and the new version starts; this page refreshes automatically. Any task still running is interrupted.',
      'restart.confirmOk': 'Restart',
      'restart.title': 'Restarting on {version}',
      'restart.body': 'The old service is closing; this page refreshes automatically once the new version is up.',
      'restart.failed': 'Timed out waiting for the new service. Check the log and start it by hand: {log}',
      'restart.reload': 'Reload page',
      'restart.requestFailed': 'Restart failed: {reason}',
      'restart.busy': 'Restarting…',
      'confirm.title': 'Delete {version}?',
      'confirm.body': 'This removes the install directory and its cache entries, releasing about {size}. It cannot be undone.',
      'confirm.bodyNoSize': 'This removes the install directory and its cache entries for {version}. It cannot be undone.',
      'confirm.cleanTitle': 'Clean cache leftovers?',
      'confirm.cleanBody': 'This removes cache entries for {count} versions, releasing about {size}. Installed versions are untouched.',
      'confirm.cancel': 'Cancel',
      'confirm.ok': 'Delete',
      'done.deleted': 'Removed {versions}, releasing {size}.',
      'done.cleaned': 'Cleaned {count} cache-only versions, releasing {size}.',
      'refused.latest': '{version} is the latest version and was kept.',
      'refused.running': '{version} is running and was kept.',
      'error.action': 'Action failed: {message}',
      'error.scan': 'Scan failed: {message}',
      'error.retry': 'Retry',
      'empty.orphan': 'No other installed npx versions.',
      'note.protected': 'The npm area only upgrades and never deletes; the npx area can delete old versions, but never the newest or the running one.',
      'tip.button': 'Tip the developer',
      'tip.title': 'Tip the developer',
      'tip.hint': 'Buy the author a coffee via PayPal — or chip in for his hair transplant fund~',
      'tip.qrPlaceholder': 'WeChat payment QR code\npending',
      'tip.linkPlaceholder': 'PayPal link pending',
      'tip.openPaypal': 'Open PayPal',
      'roots.summary': '{npx} installs · {versions} cached versions · {entries} cache entries',
    }

    const CSS = `
.dshvm-root { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.dshvm-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 28px 36px 56px; }
.dshvm-inner { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.dshvm-header { display: flex; align-items: flex-start; gap: 12px; }
.dshvm-mark { flex: none; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.dshvm-heading { min-width: 0; }
.dshvm-heading h1 { margin: 0; font-size: 17px; line-height: 22px; font-weight: 600; }
.dshvm-heading p { margin: 4px 0 0; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshvm-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.dshvm-toolbar-sep { flex: none; width: 1px; height: 18px; background: var(--dsw-alias-border-l1); margin: 0 3px; }
.dshvm-btn { font: inherit; font-size: 12px; line-height: 16px; padding: 7px 12px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; }
.dshvm-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dshvm-btn:disabled { opacity: .55; cursor: default; }
.dshvm-btn-danger { color: var(--dsw-alias-state-error-primary); }
.dshvm-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dshvm-section { display: flex; flex-direction: column; gap: 8px; }
.dshvm-section[hidden] { display: none !important; }
.dshvm-switcher { display: flex; gap: 6px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); align-self: stretch; }
.dshvm-switch { flex: 1; position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 18px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; letter-spacing: .03em; cursor: pointer; }
.dshvm-switch:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshvm-switch-active, .dshvm-switch-active:hover { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-state-success-primary, #30a46c); border-color: var(--dsw-alias-state-success-primary, #30a46c); box-shadow: inset 0 2px 0 currentColor, 0 1px 2px rgb(0 0 0 / 10%); }
.dshvm-switch-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-error-primary, #e5484d); flex: none; }
.dshvm-tabbar { display: flex; align-items: center; gap: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshvm-tab-info { font-size: 12.5px; font-weight: 500; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshvm-status { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 0 2px; }
.dshvm-status-main { font-size: 12.5px; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshvm-status-chip { flex: none; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 1px 9px; }
.dshvm-groupbar { display: flex; align-items: center; gap: 10px; padding: 6px 2px 0; }
.dshvm-groupbar-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dshvm-chip { font-size: 11.5px; line-height: 18px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshvm-list { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dshvm-row { display: flex; align-items: center; gap: 14px; padding: 11px 13px; }
.dshvm-row + .dshvm-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.dshvm-row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.dshvm-row-title { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.dshvm-channel { font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshvm-channel-rc { color: var(--dsw-alias-state-warn-primary); }
.dshvm-channel-alpha { color: var(--dsw-alias-brand-primary); }
.dshvm-version { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; font-weight: 600; }
.dshvm-badge { font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshvm-badge-latest { color: var(--dsw-alias-state-success-primary); }
.dshvm-badge-running { color: var(--dsw-alias-brand-primary); }
.dshvm-badge-cacheOnly { color: var(--dsw-alias-state-warn-primary); }
.dshvm-badge-installed { color: var(--dsw-alias-state-success-primary); }
.dshvm-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshvm-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshvm-empty { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 16px 14px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dshvm-loading { display: flex; align-items: center; gap: 10px; padding: 18px 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dshvm-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-brand-primary); animation: dshvm-pulse 1.1s ease-in-out infinite; }
@keyframes dshvm-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.dshvm-notice { border-radius: 9px; padding: 9px 12px; font-size: 12.5px; line-height: 18px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dshvm-notice-error { color: var(--dsw-alias-state-error-primary); }
.dshvm-notice-ok { color: var(--dsw-alias-state-success-primary); }
.dshvm-roots { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dshvm-roots code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.dshvm-note { font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
.dshvm-tip-dialog { width: min(380px, 100%); text-align: center; }
.dshvm-tip-dialog h2 { text-align: left; }
.dshvm-tip-dialog p { text-align: left; }
.dshvm-tip-qr { width: 196px; height: 196px; margin: 12px auto 4px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); object-fit: contain; display: block; }
.dshvm-tip-qr-empty { display: flex; align-items: center; justify-content: center; padding: 8px; text-align: center; white-space: pre-line; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); border-style: dashed; }
.dshvm-tip-link { display: inline-flex; align-items: center; justify-content: center; margin: 12px auto 4px; padding: 8px 16px; text-decoration: none; }
.dshvm-tip-link-empty { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshvm-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, .38); }
.dshvm-dialog { width: min(420px, 100%); border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); padding: 18px; box-shadow: 0 12px 40px rgba(0, 0, 0, .28); }
.dshvm-dialog h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.dshvm-dialog p { margin: 8px 0 0; font-size: 12.5px; line-height: 19px; color: var(--dsw-alias-label-secondary); }
.dshvm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dshvm-restart-status { display: flex; align-items: center; gap: 9px; margin-top: 14px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dshvm-status-action { flex: none; }
@media (max-width: 720px) { .dshvm-root { padding: 20px 18px 40px; } .dshvm-path { max-width: 100%; } }
`

    /** Human byte size, e.g. `1.4 GB`. */
    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let size = value
      let unit = -1
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit += 1
      }
      return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
    }

    /** Calendar day of an epoch-millisecond timestamp. */
    function formatDay(timestamp) {
      if (!timestamp) return ''
      const date = new Date(timestamp)
      if (Number.isNaN(date.getTime())) return ''
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    /** Semver ordering, including prerelease identifiers. */
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
      for (let index = 0; index < 3; index += 1) {
        const delta = (a.main[index] ?? 0) - (b.main[index] ?? 0)
        if (delta !== 0) return delta
      }
      if (a.pre.length === 0 && b.pre.length === 0) return 0
      if (a.pre.length === 0) return 1
      if (b.pre.length === 0) return -1
      const length = Math.max(a.pre.length, b.pre.length)
      for (let index = 0; index < length; index += 1) {
        const x = a.pre[index]
        const y = b.pre[index]
        if (x === undefined) return -1
        if (y === undefined) return 1
        const xNumeric = /^\d+$/.test(x)
        const yNumeric = /^\d+$/.test(y)
        if (xNumeric && yNumeric) {
          const delta = Number(x) - Number(y)
          if (delta !== 0) return delta
        } else if (xNumeric) return -1
        else if (yNumeric) return 1
        else if (x !== y) return x < y ? -1 : 1
      }
      return 0
    }

    /** Newest of a list, or null. */
    function newestOf(versions) {
      let newest = null
      for (const version of versions) {
        if (newest === null || compareVersions(version, newest) > 0) newest = version
      }
      return newest
    }

    /** Which channel a version belongs to. */
    function channelOf(version) {
      if (RC_VERSION.test(version)) return 'rc'
      if (ALPHA_VERSION.test(version)) return 'alpha'
      return 'stable'
    }

    /* --------------------------------------------------------------------- */
    /* language: China by time zone, everything else English                  */
    /* --------------------------------------------------------------------- */

    /** Manual choice outranks the time zone and survives restarts. */
    const LANGUAGE_KEY = 'dsh-version-manager:language'
    /** IANA zones that belong to mainland China; Hong Kong and Macau default to English. */
    const CHINA_ZONES = new Set([
      'Asia/Shanghai',
      'Asia/Chongqing',
      'Asia/Harbin',
      'Asia/Urumqi',
      'Asia/Kashgar',
      'PRC',
    ])

    /** Current panel language: a stored choice, else the time zone's answer. */
    function detectLanguage() {
      try {
        const stored = window.localStorage.getItem(LANGUAGE_KEY)
        if (stored === 'zh' || stored === 'en') return stored
      } catch {
        /* private mode: fall through to the time zone */
      }
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
        return CHINA_ZONES.has(zone) ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    /** Tiny observable so the page and the sidebar label share one choice. */
    const languageStore = { current: detectLanguage(), listeners: new Set() }

    /** Change the panel language and refresh everything that prints it. */
    function setLanguage(language) {
      languageStore.current = language === 'zh' ? 'zh' : 'en'
      try {
        window.localStorage.setItem(LANGUAGE_KEY, languageStore.current)
      } catch {
        /* the choice then lasts for this page only */
      }
      for (const listener of languageStore.listeners) listener()
      refreshSidebarLabel?.()
    }

    /** Re-register the navigation entry so the sidebar re-projects its label. */
    let refreshSidebarLabel = null

    /** Translate one key with `{name}` placeholders in the current language. */
    function translate(language, key, params) {
      const dict = language === 'zh' ? zh : en
      const template = dict[key] ?? en[key] ?? key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /** Subscribe one component to the panel language. */
    function useLanguage() {
      const [language, setCurrent] = React.useState(languageStore.current)
      React.useEffect(() => {
        const listener = () => setCurrent(languageStore.current)
        languageStore.listeners.add(listener)
        return () => languageStore.listeners.delete(listener)
      }, [])
      return language
    }

    /**
     * The published version that would move each CLI area forward, or null per
     * area. The desktop installer has no version in its fixed URL; its published
     * version comes from Content-Disposition and is handled separately.
     */
    function areaUpdateVersions(inventory, registry) {
      const none = { published: null, npm: null, npx: null }
      if (inventory === null || registry?.ok !== true) return none
      const published = newestOf([registry.rc, registry.alpha].filter((version) => typeof version === 'string'))
      if (published === null) return none
      const npmVersions = (inventory.globals ?? []).map((entry) => entry.version)
      const npxVersions = (inventory.rows ?? []).filter((row) => row.installed).map((row) => row.version)
      return {
        published,
        npm: npmVersions.length > 0 && compareVersions(published, newestOf(npmVersions)) > 0 ? published : null,
        npx: npxVersions.length > 0 && compareVersions(published, newestOf(npxVersions)) > 0 ? published : null,
      }
    }

    /** The published desktop version parsed from the installer's Content-Disposition. */
    function desktopPublishedVersion(snapshot) {
      const value = snapshot?.publishedVersion
      return typeof value === 'string' && value !== '' ? value : null
    }

    /** The installed desktop version, when the Host could read it. */
    function desktopInstalledVersion(snapshot) {
      const value = snapshot?.installed?.version
      return typeof value === 'string' && value !== '' ? value : null
    }

    /** A desktop update is a published version newer than the installed one. */
    function hasDesktopUpdate(dismissed, snapshot) {
      const published = desktopPublishedVersion(snapshot)
      const installed = desktopInstalledVersion(snapshot)
      if (published === null || installed === null) return false
      return compareVersions(published, installed) > 0 && !isDismissedUpdate(dismissed, 'desktop', published)
    }

    /** Acknowledged updates survive reloads and expire when a newer version appears. */
    const UPDATE_DISMISS_KEY = 'dsh-version-manager:dismissed'

    /** Read the acknowledged updates; malformed or unavailable storage means none. */
    function loadDismissedUpdates() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(UPDATE_DISMISS_KEY) ?? '{}')
        if (parsed !== null && typeof parsed === 'object') {
          return {
            npm: typeof parsed.npm === 'string' ? parsed.npm : undefined,
            npx: typeof parsed.npx === 'string' ? parsed.npx : undefined,
            desktop: typeof parsed.desktop === 'string' && /^\d+\.\d+\.\d+/.test(parsed.desktop) ? parsed.desktop : undefined,
          }
        }
      } catch {
        /* private mode or malformed value: treat as none */
      }
      return {}
    }

    /** Persist acknowledged updates; a failed write only loses them on reload. */
    function saveDismissedUpdates(value) {
      try {
        window.localStorage.setItem(UPDATE_DISMISS_KEY, JSON.stringify(value))
      } catch {
        /* the dismissal then lasts for this page only */
      }
    }

    /** Whether this exact area/version pair was already acknowledged. */
    function isDismissedUpdate(dismissed, area, version) {
      return typeof version === 'string' && dismissed[area] === version
    }

    /**
     * The sidebar marker and the tab dots share one store: clicking a tab
     * acknowledges that area's published version, and the sidebar `new` only
     * remains while at least one area is still unacknowledged.
     */
    const updateState = {
      inventory: null,
      registry: null,
      desktop: null,
      dismissed: loadDismissedUpdates(),
      listeners: new Set(),
    }

    /** Tell the page and the sidebar marker that the shared state moved. */
    function notifyUpdateState() {
      for (const listener of updateState.listeners) listener()
    }

    /**
     * Record the inventory/registry/desktop answer the background check just
     * fetched. The desktop area compares the published version with the
     * installed one, so no date baseline is kept here.
     */
    function setUpdateData(inventory, registry, desktop) {
      updateState.inventory = inventory
      updateState.registry = registry
      if (desktop !== undefined && desktop !== null) updateState.desktop = desktop
      notifyUpdateState()
    }

    /** Whether any area still has an unacknowledged update. */
    function visibleUpdate() {
      const versions = areaUpdateVersions(updateState.inventory, updateState.registry)
      return (
        (versions.npm !== null && !isDismissedUpdate(updateState.dismissed, 'npm', versions.npm)) ||
        (versions.npx !== null && !isDismissedUpdate(updateState.dismissed, 'npx', versions.npx)) ||
        hasDesktopUpdate(updateState.dismissed, updateState.desktop)
      )
    }

    /** Stylesheet adding the red `new` after the navigation entry while an update exists. */
    function badgeCss() {
      const labels = [...new Set([translate('zh', 'panel'), translate('en', 'panel')])]
      const selector = labels.map((label) => `button[aria-label="${label}"]::after`).join(',\n')
      return `${selector} {
  content: "new";
  margin-inline-start: 6px;
  font-size: 10px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: .02em;
  color: var(--dsw-alias-state-error-primary);
  align-self: center;
}`
    }

    /** Re-run the update check after an install/uninstall. */
    let recheckUpdates = null

    /** Same-origin JSON request that surfaces the Host's error payload. */
    async function requestJson(url, init) {
      const response = await fetch(url, init)
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok === false) {
        const error = new Error(payload?.error ?? `HTTP ${response.status}`)
        error.status = response.status
        error.payload = payload
        throw error
      }
      return payload
    }

    /** Fold measured install sizes into the inventory the page already shows. */
    function withSizes(data, sizes) {
      const rows = (data.rows ?? []).map((row) => {
        const installBytes = (row.paths ?? []).reduce((total, directory) => total + (sizes?.[directory] ?? 0), 0)
        return { ...row, installBytes, bytes: installBytes + row.cacheBytes, measured: true }
      })
      const deletable = rows.filter((row) => !row.latest && !row.running)
      return {
        ...data,
        measured: true,
        rows,
        totals: {
          ...data.totals,
          installBytes: rows.reduce((total, row) => total + row.installBytes, 0),
          reclaimableBytes: deletable.reduce((total, row) => total + row.bytes, 0),
        },
      }
    }

    /** Stacked layers: the navigation glyph and the page mark. */
    function LayersIcon({ size = 20 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M10 2.7 17.2 6.35 10 10 2.8 6.35 10 2.7Z' }),
        h('path', { d: 'M2.8 10 10 13.65 17.2 10' }),
        h('path', { d: 'M2.8 13.65 10 17.3 17.2 13.65' }),
      )
    }

    /** One confirmation dialog for every destructive action on the page. */
    function ConfirmDialog({ title, body, confirmLabel, busy, busyLabel, t, onCancel, onConfirm }) {
      const confirmRef = React.useRef(null)
      React.useEffect(() => {
        confirmRef.current?.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onCancel])
      return h(
        'div',
        {
          className: 'dshvm-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onCancel()
          },
        },
        h(
          'div',
          { className: 'dshvm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', null, title),
          h('p', null, body),
          h(
            'div',
            { className: 'dshvm-dialog-actions' },
            h('button', { type: 'button', className: 'dshvm-btn', onClick: onCancel, disabled: busy }, t('confirm.cancel')),
            h(
              'button',
              { type: 'button', ref: confirmRef, className: 'dshvm-btn dshvm-btn-danger', onClick: onConfirm, disabled: busy },
              busy ? (busyLabel ?? t('busy.deleting')) : confirmLabel,
            ),
          ),
        ),
      )
    }

    /**
     * Non-dismissable overlay while the Host shuts the old service down and the
     * detached helper starts the new one. It disappears by reloading the page
     * once the new server answers with the target version.
     */
    function RestartDialog({ version, log, failed, t }) {
      return h(
        'div',
        { className: 'dshvm-overlay' },
        h(
          'div',
          { className: 'dshvm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('restart.title', { version }) },
          h('h2', null, t('restart.title', { version })),
          failed
            ? h(
                React.Fragment,
                null,
                h('p', null, t('restart.failed', { log: log || '—' })),
                h(
                  'div',
                  { className: 'dshvm-dialog-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'dshvm-btn dshvm-btn-primary', onClick: () => window.location.reload() },
                    t('restart.reload'),
                  ),
                ),
              )
            : h(
                React.Fragment,
                null,
                h('p', null, t('restart.body')),
                h('div', { className: 'dshvm-restart-status' }, h('span', { className: 'dshvm-dot' }), t('restart.busy')),
              ),
        ),
      )
    }

    /**
     * Non-dismissable overlay while an install or upgrade runs. The install can
     * take minutes, and a button caption alone reads as "nothing happened".
     */
    function ProgressDialog({ title, lines, status }) {
      return h(
        'div',
        { className: 'dshvm-overlay' },
        h(
          'div',
          { className: 'dshvm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', null, title),
          lines.map((line, index) => h('p', { key: index }, line)),
          h('div', { className: 'dshvm-restart-status' }, h('span', { className: 'dshvm-dot' }), status),
        ),
      )
    }

    /** One registry row: channel, version, state, and its upgrade action. */
    function ChannelRow({ channel, version, target, area, versions, running, busy, onUpgrade, t }) {
      if (version === null) {
        return h(
          'div',
          { className: 'dshvm-row' },
          h(
            'div',
            { className: 'dshvm-row-main' },
            h('div', { className: 'dshvm-row-title' }, h('span', { className: `dshvm-channel dshvm-channel-${channel}` }, t(`channel.${channel}`))),
            h('div', { className: 'dshvm-meta' }, t('state.unpublished')),
          ),
        )
      }
      /**
       * Upgrades are offered per channel: an rc newer than the installed rc is
       * worth offering even when a newer alpha is installed, because the two
       * channels install side by side. The sidebar `new` marker is stricter —
       * it only appears when nothing installed is that new.
       */
      const channelCurrent = newestOf(versions.filter((entry) => channelOf(entry) === channel))
      const installed = versions.includes(version)
      const isRunning = running.includes(version)
      const newer = channelCurrent === null || compareVersions(version, channelCurrent) > 0
      const key = `${target}:${version}`
      const working = busy !== null && busy.key === key

      const badges = []
      if (isRunning) badges.push(['running', t('badge.running')])
      else if (installed) badges.push(['installed', t('state.installed')])
      else badges.push(['missing', t('state.missing')])

      const action = newer
        ? h(
            'button',
            {
              type: 'button',
              className: 'dshvm-btn dshvm-btn-primary',
              disabled: busy !== null,
              onClick: () => onUpgrade(target, version),
            },
            working ? t('upgrade.running') : versions.length === 0 ? t('action.install') : t('action.upgrade'),
          )
        : null

      return h(
        'div',
        { className: 'dshvm-row' },
        h(
          'div',
          { className: 'dshvm-row-main' },
          h(
            'div',
            { className: 'dshvm-row-title' },
            h('span', { className: `dshvm-channel dshvm-channel-${channel}` }, t(`channel.${channel}`)),
            h('span', { className: 'dshvm-version' }, version),
            badges.map(([kind, label]) => h('span', { key: kind, className: `dshvm-badge dshvm-badge-${kind}` }, label)),
          ),
          channelCurrent === null
            ? null
            : h('div', { className: 'dshvm-meta' }, t('row.newestInstalled', { area, version: channelCurrent })),
        ),
        action,
      )
    }

    /** One installed npx version row with its delete action. */
    function VersionRow({ row, t, onDelete, busy }) {
      const badges = []
      if (row.latest) badges.push(['latest', t('badge.latest')])
      if (row.running) badges.push(['running', t('badge.running')])
      if (!row.installed) badges.push(['cacheOnly', t('badge.cacheOnly')])
      const deletable = !row.latest && !row.running
      return h(
        'div',
        { className: 'dshvm-row' },
        h(
          'div',
          { className: 'dshvm-row-main' },
          h(
            'div',
            { className: 'dshvm-row-title' },
            h('span', { className: 'dshvm-version' }, row.version),
            badges.map(([kind, label]) => h('span', { key: kind, className: `dshvm-badge dshvm-badge-${kind}` }, label)),
          ),
          h(
            'div',
            { className: 'dshvm-meta' },
            row.installBytes > 0 ? h('span', null, t('row.install', { size: formatBytes(row.installBytes) })) : row.installed && !row.measured ? h('span', null, t('row.measuring')) : null,
            row.cacheBytes > 0 ? h('span', null, t('row.cache', { size: formatBytes(row.cacheBytes) })) : null,
            row.lastUsed ? h('span', null, t('row.lastUsed', { time: formatDay(row.lastUsed) })) : null,
            h('span', { className: 'dshvm-path', title: (row.paths ?? []).join('\n') }, row.paths?.[0] ?? ''),
          ),
        ),
        deletable
          ? h(
              'button',
              {
                type: 'button',
                className: 'dshvm-btn dshvm-btn-danger',
                disabled: busy,
                onClick: () => onDelete(row),
              },
              row.installed ? t('action.delete') : t('action.clean'),
            )
          : null,
      )
    }

    /**
     * Tip dialog: a WeChat payment QR for the Chinese panel, a PayPal link for
     * the English one. Both assets live in `TIP` and render a placeholder until
     * they are provided.
     */
    function TipDialog({ language, t, onClose }) {
      const closeRef = React.useRef(null)
      React.useEffect(() => {
        closeRef.current?.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      return h(
        'div',
        {
          className: 'dshvm-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'dshvm-dialog dshvm-tip-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tip.title') },
          h('h2', null, t('tip.title')),
          language === 'zh'
            ? h(
                React.Fragment,
                null,
                h('p', null, t('tip.hint')),
                TIP.qrcode
                  ? h('img', { className: 'dshvm-tip-qr', src: TIP.qrcode, alt: t('tip.hint') })
                  : h('div', { className: 'dshvm-tip-qr dshvm-tip-qr-empty' }, t('tip.qrPlaceholder')),
              )
            : h(
                React.Fragment,
                null,
                h('p', null, t('tip.hint')),
                TIP.link
                  ? h(
                      'a',
                      { className: 'dshvm-btn dshvm-btn-primary dshvm-tip-link', href: TIP.link, target: '_blank', rel: 'noreferrer noopener' },
                      t('tip.openPaypal'),
                    )
                  : h('div', { className: 'dshvm-tip-link dshvm-tip-link-empty' }, t('tip.linkPlaceholder')),
              ),
          h(
            'div',
            { className: 'dshvm-dialog-actions' },
            h('button', { type: 'button', ref: closeRef, className: 'dshvm-btn', onClick: onClose }, t('confirm.cancel')),
          ),
        ),
      )
    }

    /** The segmented area switcher; the user's current install method comes first. */
    function TabBar({ order, active, updates, onSelect, t }) {
      return h(
        'div',
        { className: 'dshvm-switcher', role: 'tablist' },
        order.map((area) =>
          h(
            'button',
            {
              key: area,
              type: 'button',
              role: 'tab',
              'aria-selected': active === area ? 'true' : 'false',
              className: `dshvm-switch ${active === area ? 'dshvm-switch-active' : ''}`,
              onClick: () => onSelect(area),
            },
            t(`area.${area}`),
            updates[area] === true ? h('span', { className: 'dshvm-switch-dot', 'aria-hidden': 'true' }) : null,
          ),
        ),
      )
    }

    /** The desktop client area: installed and published versions, installer facts, and install. */
    function DesktopArea({ snapshot, t, busy, onInstall }) {
      const installed = snapshot?.installed ?? null
      const published = desktopPublishedVersion(snapshot)
      const installedVersion = desktopInstalledVersion(snapshot)
      const canUpgrade = published !== null && installedVersion !== null && compareVersions(published, installedVersion) > 0
      const supported = snapshot?.supported === true
      const facts = []
      if (snapshot?.size > 0) facts.push(t('desktop.size', { size: formatBytes(snapshot.size) }))
      if (snapshot?.modified) facts.push(t('desktop.released', { date: formatDay(Date.parse(snapshot.modified)) }))

      return h(
        'section',
        { className: 'dshvm-section' },
        h(
          'div',
          { className: 'dshvm-list' },
          h(
            'div',
            { className: 'dshvm-row' },
            h(
              'div',
              { className: 'dshvm-row-main' },
              h(
                  'div',
                  { className: 'dshvm-row-title' },
                  h('span', { className: 'dshvm-version' }, installed === null ? t('desktop.notInstalled') : (installed.version ?? t('state.installed'))),
                  published !== null
                    ? h('span', { className: 'dshvm-badge dshvm-badge-latest' }, t('desktop.latest', { version: published }))
                    : supported && snapshot !== null
                      ? h('span', { className: 'dshvm-badge' }, t('desktop.latestUnknown'))
                      : null,
                ),
              h(
                'div',
                { className: 'dshvm-meta' },
                supported
                  ? h('span', { className: 'dshvm-path', title: snapshot?.url ?? '' }, snapshot?.fileName ?? '')
                  : h('span', null, t('desktop.unsupported')),
                facts.length > 0 ? h('span', null, facts.join(' · ')) : null,
                installed?.location ? h('span', { className: 'dshvm-path', title: installed.location }, installed.location) : null,
              ),
            ),
            supported
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshvm-btn dshvm-btn-primary',
                    disabled: busy,
                    onClick: onInstall,
                  },
                  busy ? t('desktop.installing') : canUpgrade ? t('action.upgrade') : t('desktop.install'),
                )
              : null,
          ),
        ),
        h('p', { className: 'dshvm-note' }, t('desktop.hint')),
        snapshot !== null && snapshot.reachable === false
          ? h('p', { className: 'dshvm-note' }, t('desktop.unreachable'))
          : null,
      )
    }

    /** The panel page. */
    function VersionManagerPage(props) {
      const language = useLanguage()
      const t = React.useMemo(() => (key, params) => translate(language, key, params), [language])
      const [inventory, setInventory] = React.useState(null)
      const [registry, setRegistry] = React.useState(null)
      const [registryError, setRegistryError] = React.useState(null)
      const [scanError, setScanError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [refreshing, setRefreshing] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [pending, setPending] = React.useState(null)
      const [tipOpen, setTipOpen] = React.useState(false)
      const [desktop, setDesktop] = React.useState(null)
      const [desktopBusy, setDesktopBusy] = React.useState(false)
      const [creatingShortcut, setCreatingShortcut] = React.useState(false)
      const [pickedArea, setPickedArea] = React.useState(null)
      /** Set while the Host restarts; `{ version, log, failed }`. */
      const [restarting, setRestarting] = React.useState(null)
      /** Published versions the user already acknowledged, shared with the sidebar. */
      const [dismissed, setDismissed] = React.useState(() => ({ ...updateState.dismissed }))

      const measureSizes = React.useCallback(async (data) => {
        const directories = [...new Set((data.rows ?? []).flatMap((row) => row.paths ?? []))]
        if (directories.length === 0) return
        try {
          const result = await requestJson(SIZES_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ directories }),
          })
          setInventory((current) => (current === data ? withSizes(data, result.sizes ?? {}) : current))
        } catch {
          /* sizes are cosmetic */
        }
      }, [])

      const load = React.useCallback(
        async (options = {}) => {
          const force = options.force === true
          if (force) setRefreshing(true)
          else setLoading(true)
          setScanError(null)
          const registryUrl = force ? `${REGISTRY_URL}?force=1` : REGISTRY_URL
          const [listResult, registryResult, desktopResult] = await Promise.all([
            requestJson(LIST_URL, { method: 'GET' }).catch((error) => ({ __error: error })),
            requestJson(registryUrl, { method: 'GET' }).catch((error) => ({ __error: error, payload: error.payload })),
            requestJson(DESKTOP_URL, { method: 'GET' }).catch(() => null),
          ])
          setDesktop(desktopResult && desktopResult.__error === undefined ? desktopResult : null)
          if (listResult.__error) {
            setScanError(String(listResult.__error?.message ?? listResult.__error))
          } else {
            setInventory(listResult)
            void measureSizes(listResult)
          }
          if (registryResult.__error) {
            setRegistry(null)
            setRegistryError(
              registryResult.__error?.status === 404
                ? 'restart'
                : String(registryResult.payload?.error ?? registryResult.__error?.message ?? registryResult.__error),
            )
          } else {
            setRegistry(registryResult)
            setRegistryError(registryResult.ok === false ? String(registryResult.error ?? 'unknown') : null)
          }
          setLoading(false)
          setRefreshing(false)
          setUpdateData(
            listResult.__error ? null : listResult,
            registryResult.__error ? null : registryResult,
            desktopResult && desktopResult.__error === undefined ? desktopResult : null,
          )
        },
        [measureSizes],
      )

      React.useEffect(() => {
        load()
      }, [load])

      // Keep an open panel in step with the hourly background check: a new
      // desktop release (or npm/npx answer) updates its tab dot without a reload.
      React.useEffect(() => {
        const listener = () => {
          if (updateState.desktop !== null) setDesktop(updateState.desktop)
          setDismissed({ ...updateState.dismissed })
        }
        updateState.listeners.add(listener)
        return () => updateState.listeners.delete(listener)
      }, [])

      /**
       * Poll the list route until the restarted server reports the target
       * version from a new process. A reply from the old process still carries
       * the old version and PID, so neither the version nor a same-version
       * restart may reload early.
       */
      const waitForRestart = React.useCallback((version, log, previousPid) => {
        const started = Date.now()
        const tick = async () => {
          if (Date.now() - started > 120000) {
            setRestarting({ version, log, failed: true })
            return
          }
          const controller = new AbortController()
          const timer = window.setTimeout(() => controller.abort(), 2500)
          try {
            const response = await fetch(LIST_URL, { cache: 'no-store', signal: controller.signal })
            if (response.ok) {
              const data = await response.json().catch(() => null)
              const sameProcess = previousPid !== undefined && previousPid !== null && data?.runtime?.pid === previousPid
              if (data?.runtime?.version === version && !sameProcess) {
                window.location.reload()
                return
              }
            }
          } catch {
            /* the old listener is gone and the new one has not bound yet */
          } finally {
            window.clearTimeout(timer)
          }
          window.setTimeout(tick, 1000)
        }
        window.setTimeout(tick, 1500)
      }, [])

      /** Ask the Host to exit and relaunch on `version`, then wait for it. */
      const beginRestart = React.useCallback(
        async (target, version, previousPid) => {
          setPending(null)
          setNotice(null)
          setBusy({ kind: 'restart', key: `${target}:${version}` })
          try {
            const result = await requestJson(RESTART_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ target, version }),
            })
            const log = typeof result.log === 'string' ? result.log : ''
            setRestarting({ version, log, failed: false })
            waitForRestart(version, log, previousPid)
          } catch (error) {
            setBusy(null)
            setNotice({
              kind: 'error',
              text: t('restart.requestFailed', { reason: String(error?.payload?.error ?? error?.message ?? error) }),
            })
            // The install may still have succeeded; show it and its restart action.
            await load()
          }
        },
        [load, t, waitForRestart],
      )

      /** Acknowledge every update of one area; a newer version/date resets it. */
      const dismissArea = React.useCallback((area, version) => {
        if (typeof version !== 'string' || version === '') return
        updateState.dismissed = { ...updateState.dismissed, [area]: version }
        saveDismissedUpdates(updateState.dismissed)
        setDismissed({ ...updateState.dismissed })
        notifyUpdateState()
      }, [])

      /**
     * Put a launcher on the Desktop for whatever this machine runs, replacing the
     * one a previous click (or the user) left behind.
     */
    const makeShortcut = React.useCallback(async () => {
      setCreatingShortcut(true)
      setNotice(null)
      try {
        const result = await requestJson(SHORTCUT_URL, { method: 'POST' })
        setNotice({
          kind: 'ok',
          text: t(result.mode === 'command' ? 'shortcut.doneCommand' : 'shortcut.done', { path: result.path ?? '' }),
        })
      } catch (error) {
        const reason = String(error?.payload?.error ?? error?.message ?? error)
        setNotice({ kind: 'error', text: t('shortcut.failed', { reason }) })
      } finally {
        setCreatingShortcut(false)
      }
    }, [t])

    const installDesktop = React.useCallback(async () => {
        const pick = props.pickDirectory
        if (typeof pick !== 'function') {
          setNotice({ kind: 'error', text: t('desktop.noPicker') })
          return
        }
        let directory = null
        try {
          directory = await pick()
        } catch {
          directory = null
        }
        // Cancelling the folder picker stops the flow before anything is fetched.
        if (typeof directory !== 'string' || directory.length === 0) return
        setDesktopBusy(true)
        setNotice(null)
        try {
          const result = await requestJson(DESKTOP_INSTALL_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ directory }),
          })
          if (result.ok === true) {
            setNotice({ kind: 'ok', text: t('desktop.done', { size: formatBytes(result.size ?? 0) }) })
          } else {
            setNotice({ kind: 'error', text: t('desktop.failed', { reason: String(result.error ?? 'unknown') }) })
          }
        } catch (error) {
          const reason = String(error?.payload?.error ?? error?.message ?? error)
          setNotice({ kind: 'error', text: t('desktop.failed', { reason }) })
        } finally {
          setDesktopBusy(false)
        }
      }, [props.pickDirectory, t])

      /** Install one upgrade; when `restart` is true, relaunch on it afterwards. */
      const performUpgrade = React.useCallback(
        async (target, version, restart, previousPid) => {
          setPending(null)
          setBusy({ kind: 'upgrade', key: `${target}:${version}`, target, version, restart: restart === true })
          setNotice(null)
          try {
            await requestJson(UPGRADE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ target, version }),
            })
            recheckUpdates?.()
            if (restart) {
              setBusy(null)
              await beginRestart(target, version, previousPid)
              return
            }
            setNotice({ kind: 'ok', text: t(target === 'npm' ? 'upgrade.doneNpm' : 'upgrade.doneNpx', { version }) })
            try {
              await load()
            } finally {
              setBusy(null)
            }
          } catch (error) {
            const tail = String(error.payload?.output ?? '').trim().split('\n').slice(-2).join(' · ')
            setBusy(null)
            setNotice({
              kind: 'error',
              text: t('upgrade.failed', { version, message: tail || String(error?.message ?? error) }),
            })
          }
        },
        [beginRestart, load, t],
      )

      /**
       * Upgrading the install this process runs from only takes effect after a
       * restart, so ask first and then restart automatically. An upgrade of the
       * other area is just an install.
       */
      const runUpgrade = React.useCallback(
        async (target, version) => {
          const runtime = inventory?.runtime ?? null
          const rowsRunning = (inventory?.rows ?? []).some((row) => row.running) ? 'npx' : null
          const runningKind = runtime?.kind ?? rowsRunning
          if (runtime?.canRestart === true && runningKind === target) {
            setPending({
              kind: 'upgrade',
              target,
              version,
              pid: inventory?.runtime?.pid,
              title: t('upgrade.confirmRestartTitle', { version }),
              body: t('upgrade.confirmRestartBody'),
              confirmLabel: t('upgrade.confirmRestartOk'),
            })
            return
          }
          await performUpgrade(target, version, false)
        },
        [inventory, performUpgrade, t],
      )

      const runDelete = React.useCallback(
        async (plan) => {
          setPending(null)
          setBusy({ kind: 'delete', key: plan.versions.join(',') })
          setNotice(null)
          try {
            const result = await requestJson(DELETE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ mode: plan.mode, versions: plan.versions }),
            })
            const text =
              plan.mode === 'cache'
                ? t('done.cleaned', { count: plan.versions.length, size: formatBytes(result.freed) })
                : t('done.deleted', { versions: plan.versions.join(', '), size: formatBytes(result.freed) })
            setNotice({ kind: 'ok', text })
          } catch (error) {
            const refused = Array.isArray(error.payload?.refused) ? error.payload.refused : []
            const text =
              refused.length > 0
                ? refused.map((entry) => t(`refused.${entry.reason}`, { version: entry.version })).join(' ')
                : t('error.action', { message: String(error?.message ?? error) })
            setNotice({ kind: 'error', text })
          } finally {
            setBusy(null)
            await load()
            recheckUpdates?.()
          }
        },
        [load, t],
      )

      const rows = inventory?.rows ?? []
      const installed = rows.filter((row) => row.installed)
      const globals = inventory?.globals ?? []
      const npmVersions = globals.map((entry) => entry.version)
      const npxVersions = installed.map((row) => row.version)
      const runningVersions = installed.filter((row) => row.running).map((row) => row.version)
      const npmCurrent = newestOf(npmVersions)
      const npxCurrent = newestOf(npxVersions)
      const npxRunning = runningVersions.length > 0 ? newestOf(runningVersions) : null

      // "Running" is the version this process loaded at boot, not the newest copy
      // on disk: an npx upgrade keeps the old install untouched, so afterwards
      // both are installed and only the booted one is actually current.
      const runtime = inventory?.runtime ?? null
      const runningKind = runtime?.kind ?? (npxRunning !== null ? 'npx' : null)
      const runningVersion =
        typeof runtime?.version === 'string' && runtime.version !== ''
          ? runtime.version
          : runningKind === 'npx'
            ? npxRunning
            : null
      const runtimeCanRestart = runtime?.canRestart === true
      const runningNewest = runningKind === 'npm' ? npmCurrent : runningKind === 'npx' ? npxCurrent : null
      const restartTarget =
        runtimeCanRestart &&
        runningKind !== null &&
        runningVersion !== null &&
        runningNewest !== null &&
        compareVersions(runningNewest, runningVersion) > 0
          ? runningNewest
          : null

      const totals = inventory?.totals ?? { reclaimableBytes: 0, cacheOnly: 0 }
      const reclaimable = inventory?.measured === false ? '…' : formatBytes(totals.reclaimableBytes)

      const channels = registry?.ok === true ? [
        { key: 'rc', version: registry.rc ?? null },
        { key: 'alpha', version: registry.alpha ?? null },
      ] : []
      const shownVersions = channels.map((entry) => entry.version).filter((version) => version !== null)
      const otherRows = registry?.ok === true ? rows.filter((row) => !shownVersions.includes(row.version)) : rows
      const orphans = otherRows.filter((row) => !row.installed)

      // The desktop installer's fixed URL carries no version, but its
      // Content-Disposition file name does; the panel compares that published
      // version with the installed registry/bundle version.
      const desktopInfo = desktop ?? updateState.desktop
      const desktopInstalled = desktopInfo?.installed ?? null
      const desktopLatest = desktopPublishedVersion(desktopInfo)

      // The area this process runs from comes first; the rest default to
      // npm, npx, desktop.
      const DEFAULT_AREA_ORDER = ['npm', 'npx', 'desktop']
      const areaOrder = runningKind !== null
        ? [runningKind, ...DEFAULT_AREA_ORDER.filter((area) => area !== runningKind)]
        : [...DEFAULT_AREA_ORDER]
      const activeArea = pickedArea === null ? areaOrder[0] : pickedArea

      /** Status line per area: what runs, then what is installed but not running. */
      const areaStatus = (area) => {
        const current = area === 'npm' ? npmCurrent : area === 'npx' ? npxCurrent : null
        if (runningKind === area && runningVersion !== null) {
          const head = t('section.running', { version: runningVersion })
          return current !== null && current !== runningVersion
            ? `${head} · ${t('section.newestInstalled', { version: current })}`
            : head
        }
        return current === null ? t('section.missing') : t('section.installed', { version: current })
      }
      const desktopInstalledText = desktopInstalled === null
        ? t('desktop.notInstalled')
        : desktopInstalled.version
          ? t('section.installed', { version: desktopInstalled.version })
          : t('state.installed')
      const statusText = activeArea === 'desktop'
        ? `${desktopInstalledText}${desktopLatest === null ? '' : ` · ${t('desktop.latest', { version: desktopLatest })}`}`
        : areaStatus(activeArea)
      const statusChip = activeArea === 'npx' ? t('reclaimable', { size: reclaimable }) : null

      // A dot marks a published version that beats the area's newest installed
      // copy, unless the user already acknowledged that exact version by opening
      // the tab. Desktop uses the published version from Content-Disposition.
      const updateVersions = areaUpdateVersions(inventory, registry)
      const desktopForUpdate = updateState.desktop ?? desktop
      const desktopDismissed = typeof dismissed.desktop === 'string' && dismissed.desktop !== '' ? dismissed : updateState.dismissed
      const areaUpdates = {
        npm: updateVersions.npm !== null && !isDismissedUpdate(dismissed, 'npm', updateVersions.npm),
        npx: updateVersions.npx !== null && !isDismissedUpdate(dismissed, 'npx', updateVersions.npx),
        desktop: hasDesktopUpdate(desktopDismissed, desktopForUpdate),
      }

      /** Opening an area acknowledges its update, which also updates the sidebar. */
      const selectArea = (area) => {
        setPickedArea(area)
        const version = area === 'desktop'
          ? hasDesktopUpdate(desktopDismissed, desktopForUpdate)
            ? desktopPublishedVersion(desktopForUpdate)
            : null
          : updateVersions[area]
        if (typeof version === 'string') dismissArea(area, version)
      }

      const askDelete = (row) =>
        setPending({
          mode: row.installed ? 'version' : 'cache',
          versions: [row.version],
          title: row.installed ? t('confirm.title', { version: row.version }) : t('confirm.cleanTitle'),
          body: row.installed
            ? row.measured
              ? t('confirm.body', { version: row.version, size: formatBytes(row.bytes) })
              : t('confirm.bodyNoSize', { version: row.version })
            : t('confirm.cleanBody', { count: 1, size: formatBytes(row.bytes) }),
          confirmLabel: row.installed ? t('confirm.ok') : t('action.clean'),
        })

      const askCleanAll = () =>
        setPending({
          mode: 'cache',
          versions: orphans.map((row) => row.version),
          title: t('confirm.cleanTitle'),
          body: t('confirm.cleanBody', {
            count: orphans.length,
            size: formatBytes(orphans.reduce((total, row) => total + row.bytes, 0)),
          }),
          confirmLabel: t('action.cleanAll'),
        })

      const channelPlaceholder = registryError === null
        ? t('registry.loading')
        : registryError === 'restart'
          ? t('registry.restart')
          : t('registry.failed', { message: registryError })

      return h(
        'div',
        { className: 'dshvm-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dshvm-scroll' },
          h(
          'div',
          { className: 'dshvm-inner' },
          h(
            'header',
            { className: 'dshvm-header' },
            h('div', { className: 'dshvm-mark' }, h(LayersIcon, { size: 18 })),
            h('div', { className: 'dshvm-heading' }, h('h1', null, t('title')), h('p', null, t('subtitle'))),
          ),

          // The action row sits under the title so the heading keeps its own line.
          h(
            'div',
            { className: 'dshvm-toolbar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshvm-btn',
                onClick: () => load({ force: true }),
                disabled: refreshing || busy !== null,
              },
              refreshing ? t('loading') : t('refresh'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshvm-btn',
                title: t('shortcut.title'),
                onClick: makeShortcut,
                disabled: creatingShortcut,
              },
              creatingShortcut ? t('shortcut.busy') : t('shortcut.label'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshvm-btn',
                title: runtimeCanRestart ? t('restart.nowHint') : t('restart.unsupported'),
                disabled: !runtimeCanRestart || runningKind === null || runningVersion === null || busy !== null,
                onClick: () => {
                  if (!runtimeCanRestart || runningKind === null || runningVersion === null) return
                  setPending({
                    kind: 'restart',
                    target: runningKind,
                    version: runningVersion,
                    pid: runtime?.pid,
                    title: t('restart.nowTitle'),
                    body: t('restart.nowBody'),
                    confirmLabel: t('restart.nowOk'),
                  })
                },
              },
              t('restart.now'),
            ),
            h('span', { className: 'dshvm-toolbar-sep', 'aria-hidden': 'true' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dshvm-btn',
                title: t('lang.title'),
                onClick: () => setLanguage(language === 'zh' ? 'en' : 'zh'),
                disabled: busy !== null,
              },
              t('lang.switch'),
            ),
            h(
              'button',
              { type: 'button', className: 'dshvm-btn', onClick: () => setTipOpen(true) },
              `♥ ${t('tip.button')}`,
            ),
          ),

          notice === null ? null : h('div', { className: `dshvm-notice dshvm-notice-${notice.kind}`, role: 'status' }, notice.text),
          scanError === null ? null : h(
            'div',
            { className: 'dshvm-notice dshvm-notice-error', role: 'alert' },
            t('error.scan', { message: scanError }),
            h(
              'div',
              { style: { marginTop: '8px' } },
              h('button', { type: 'button', className: 'dshvm-btn', onClick: () => load({ force: true }) }, t('error.retry')),
            ),
          ),

          loading
            ? h('div', { className: 'dshvm-loading' }, h('span', { className: 'dshvm-dot' }), t('loading'))
            : h(
                React.Fragment,
                null,

                h(TabBar, { order: areaOrder, active: activeArea, updates: areaUpdates, onSelect: selectArea, t }),

                // One status line below the switcher, describing the open area.
                h(
                  'div',
                  { className: 'dshvm-status' },
                  h('span', { className: 'dshvm-status-main' }, statusText),
                  statusChip === null ? null : h('span', { className: 'dshvm-status-chip' }, statusChip),
                  restartTarget === null || activeArea !== runningKind
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshvm-btn dshvm-btn-primary dshvm-status-action',
                          disabled: busy !== null,
                          onClick: () =>
                            setPending({
                              kind: 'restart',
                              target: runningKind,
                              version: restartTarget,
                              pid: runtime?.pid,
                              title: t('restart.confirmTitle', { version: restartTarget }),
                              body: t('restart.confirmBody'),
                              confirmLabel: t('restart.confirmOk'),
                            }),
                        },
                        t('restart.action', { version: restartTarget }),
                      ),
                ),

                // npm area: upgrade only, never delete.
                activeArea === 'npm'
                  ? h(
                      'section',
                      { className: 'dshvm-section' },
                      h(
                        'div',
                        { className: 'dshvm-list' },
                        channels.length === 0
                          ? h('div', { className: 'dshvm-row' }, h('div', { className: 'dshvm-row-main' }, h('div', { className: 'dshvm-meta' }, channelPlaceholder)))
                          : channels.map((entry) =>
                              h(ChannelRow, {
                                key: entry.key,
                                channel: entry.key,
                                version: entry.version,
                                target: 'npm',
                                area: 'npm',
                                versions: npmVersions,
                                running: [],
                                busy,
                                onUpgrade: runUpgrade,
                                t,
                              }),
                            ),
                      ),
                    )
                  : null,

                // npx area: newest rc / alpha, then the other installed versions.
                activeArea === 'npx'
                  ? h(
                      'section',
                      { className: 'dshvm-section' },
                      h(
                        'div',
                        { className: 'dshvm-list' },
                        channels.length === 0
                          ? h('div', { className: 'dshvm-row' }, h('div', { className: 'dshvm-row-main' }, h('div', { className: 'dshvm-meta' }, channelPlaceholder)))
                          : channels.map((entry) =>
                              h(ChannelRow, {
                                key: entry.key,
                                channel: entry.key,
                                version: entry.version,
                                target: 'npx',
                                area: 'npx',
                                versions: npxVersions,
                                running: runningVersions,
                                busy,
                                onUpgrade: runUpgrade,
                                t,
                              }),
                            ),
                      ),
                      h(
                        'div',
                        { className: 'dshvm-groupbar' },
                        h('span', { className: 'dshvm-groupbar-label' }, t('section.others')),
                        orphans.length > 0
                          ? h(
                              'button',
                              { type: 'button', className: 'dshvm-btn', onClick: askCleanAll, disabled: busy !== null },
                              t('action.cleanAll'),
                            )
                          : null,
                      ),
                      otherRows.length === 0
                        ? h('div', { className: 'dshvm-empty' }, t('empty.orphan'))
                        : h(
                            'div',
                            { className: 'dshvm-list' },
                            otherRows.map((row) => h(VersionRow, { key: row.version, row, t, busy: busy !== null, onDelete: askDelete })),
                          ),
                    )
                  : null,

                // desktop client: one installer, version follows the published rc.
                activeArea === 'desktop'
                  ? h(DesktopArea, {
                      snapshot: desktopInfo,
                      t,
                      busy: desktopBusy,
                      onInstall: installDesktop,
                    })
                  : null,

                h(
                  'section',
                  { className: 'dshvm-section' },
                  h('div', { className: 'dshvm-tabbar', style: { borderBottom: 'none' } }, h('span', { className: 'dshvm-tab-info' }, t('section.roots'))),
                  h(
                    'div',
                    { className: 'dshvm-roots' },
                    (inventory?.cacheRoots ?? []).map((root) =>
                      h(
                        'div',
                        { key: root.root },
                        h('code', null, root.root),
                        ` — ${t('roots.summary', {
                          npx: root.npxInstalls,
                          versions: root.cacheVersions,
                          entries: root.cacheEntries,
                        })}`,
                      ),
                    ),
                    registry === null
                      ? null
                      : h('div', null, t('registry.source', { url: registry.registry ?? '' })),
                  ),
                ),

                h('p', { className: 'dshvm-note' }, t('note.protected')),
                h('p', { className: 'dshvm-note' }, t('registry.hint')),
              ),
          ),
        ),

        tipOpen ? h(TipDialog, { language, t, onClose: () => setTipOpen(false) }) : null,

        pending === null
          ? null
          : h(ConfirmDialog, {
              title: pending.title,
              body: pending.body,
              confirmLabel: pending.confirmLabel,
              busy: busy !== null,
              busyLabel:
                pending.kind === 'delete'
                  ? t('busy.deleting')
                  : pending.kind === 'restart'
                    ? t('restart.busy')
                    : t('upgrade.running'),
              t,
              onCancel: () => {
                if (busy === null) setPending(null)
              },
              onConfirm: () => {
                if (pending.kind === 'delete') runDelete(pending)
                else if (pending.kind === 'restart') beginRestart(pending.target, pending.version, pending.pid)
                else performUpgrade(pending.target, pending.version, true, pending.pid)
              },
            }),

        busy !== null && busy.kind === 'upgrade'
          ? h(ProgressDialog, {
              title: t('upgrade.dialogTitle', { version: busy.version }),
              lines: [
                t('upgrade.dialogBody'),
                busy.restart === true ? t('upgrade.dialogAutoRestart') : t('upgrade.dialogNoRestart'),
              ],
              status: t('upgrade.dialogWorking'),
            })
          : null,

        restarting === null
          ? null
          : h(RestartDialog, {
              version: restarting.version,
              log: restarting.log,
              failed: restarting.failed === true,
              t,
            }),
      )
    }

    /** Register the panel entry, its page, and the background update marker. */
    function apply(ctx) {
      let sidebarRegister = null
      let sidebarDispose = null

      /** Re-register the entry so the sidebar picks up the current language. */
      const refreshSidebar = () => {
        if (sidebarRegister === null) return
        try {
          sidebarDispose?.()
          sidebarDispose = sidebarRegister()
        } catch (error) {
          console.error('dsh-version-manager: sidebar label refresh failed', error)
        }
      }
      refreshSidebarLabel = refreshSidebar

      /** Owned stylesheet: present only while an update exists. */
      let badgeDispose = null
      const setBadge = (visible) => {
        if (visible && badgeDispose === null) {
          badgeDispose = ctx.effect(() => {
            const element = document.createElement('style')
            element.dataset.dshVersionManager = 'new-badge'
            element.textContent = badgeCss()
            document.head.appendChild(element)
            return () => element.remove()
          }, 'dsh-version-manager: new badge')
        } else if (!visible && badgeDispose !== null) {
          badgeDispose()
          badgeDispose = null
        }
      }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({
              /** The host's native folder picker, used before the installer download. */
              pickDirectory: async () => {
                const workspace = ctx.get('uiWorkspace')
                if (typeof workspace?.pickDirectory !== 'function') return null
                return workspace.pickDirectory()
              },
            }),
          },
          VersionManagerPage,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () => {
        sidebarRegister = () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 12,
              label: () => translate(languageStore.current, 'panel'),
            },
            LayersIcon,
          )
        sidebarDispose = sidebarRegister()
        return () => {
          sidebarDispose?.()
          sidebarDispose = null
          sidebarRegister = null
          refreshSidebarLabel = null
        }
      })

      ctx.effect(() => {
        const listener = () => setBadge(visibleUpdate())
        updateState.listeners.add(listener)
        listener()
        return () => {
          updateState.listeners.delete(listener)
        }
      }, 'dsh-version-manager: update marker state')

      // Background update check: keeps the red `new` marker honest without
      // opening the panel. Failures simply leave the marker off.
      ctx.effect(() => {
        let alive = true
        const run = async () => {
          try {
            const [inventory, registry, desktop] = await Promise.all([
              requestJson(LIST_URL, { method: 'GET' }).catch(() => null),
              requestJson(REGISTRY_URL, { method: 'GET' }).catch(() => null),
              requestJson(DESKTOP_URL, { method: 'GET' }).catch(() => null),
            ])
            if (!alive) return
            setUpdateData(inventory, registry, desktop)
          } catch {
            /* the marker is decorative */
          }
        }
        recheckUpdates = () => {
          void run()
        }
        // One check at load, then once at the top of every hour.
        void run()
        let timer = 0
        const schedule = () => {
          const now = new Date()
          const next = new Date(now.getTime())
          next.setHours(now.getHours() + 1, 0, 0, 0)
          const delay = Math.max(1000, next.getTime() - now.getTime())
          timer = window.setTimeout(() => {
            void run()
            schedule()
          }, delay)
        }
        schedule()
        return () => {
          alive = false
          window.clearTimeout(timer)
          recheckUpdates = null
          setBadge(false)
        }
      }, 'dsh-version-manager: update check')
    }

    return { inject: ['slots'], apply }
  },
})