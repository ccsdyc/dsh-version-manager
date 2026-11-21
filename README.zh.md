# dsh 版本管理（dsh-update-manager）

[English](README.md) | 中文

一个 Harness 插件：在左侧导航加入 **版本管理 / Versions** 入口，以及一个用分段切换器
组织三个区域的面板。只渲染当前打开的区域；切换器下方的一条状态行说明这个区域在跑什么、
装了什么。当前进程所在的区域排在最前，其余默认按 npm、npx、desktop 排列：

- **npm** —— 全局安装的 dsh（`npm install -g`），可以升级，永不提供删除。
- **npx** —— npx 缓存里的安装：先列最新的 rc 与 alpha，再列其余已安装版本，可升级或删除。
- **desktop** —— 官方桌面客户端：已安装版本（读 Windows 卸载注册表）、从安装包文件名解析
  出的已发布版本、安装包信息，以及一键安装/升级。

状态行把当前进程**正在运行**的版本，与"只是装着"的版本分清楚。运行版本在 Host 模块加载时
从 `process.argv[1]` 所属的包里读取——绝不读磁盘上最新的那份副本。因为 npx 升级是并排安装、
不动当前进程，面板可以显示 `运行中 0.2.2-alpha.2 · 最新安装 0.2.2-alpha.3`，并提供重启到较新
副本的入口。行上的 `running` 徽标跟随进程启动时所在的 `_npx/<hash>`。

每个 CLI 区域显示两行：最新的已发布 **rc** 与最新的已发布 **alpha**。npx 安装互不覆盖，rc 与
alpha 并排存在，因此每一行只与**同通道**的最新已安装版本比较——已装的 alpha 不会掩盖比已装
rc 更新的 rc，rc 行也不会把 alpha 当成自己的当前版本。侧边栏的 `new` 标记跟随红点出现：只要
还有至少一个区域存在未确认的更新。

## 桌面客户端

官方安装包是固定 URL，文件名里不带版本号：

- Windows：`https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe`
- macOS（Apple Silicon）：`https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg`
- macOS（Intel）：`https://download.deepseek.com/desktop/dsh-latest-macos-x64.dmg`

面板显示已安装的桌面版本，以及从安装包 `Content-Disposition` 文件名里解析出的已发布版本
（固定 URL 本身不含版本），再加一个 `HEAD` 请求拿到的安装包大小与发布日期。Windows 和 Apple
Silicon 的 DMG 会返回带版本的文件名；当前的 Intel x64 DMG 不返回 `Content-Disposition`，所以
该平台显示"最新版本不可用"，也不会点亮更新红点。这项检查与平台无关：如果 x64 产物哪天开始返
回这个头，下一次检查就会读到版本，红点与界面无需改代码即可生效。Windows 读卸载注册表
（`DisplayName` 匹配 DeepSeek/dsh）；macOS 读 `/Applications` 与 `~/Applications` 下
`DeepSeek*.app` 的 `CFBundleShortVersionString`，二进制 plist 用 `plutil` 解析。在 Rosetta 下
运行的 x64 node 仍会选择 ARM64 镜像，因为机器本身是 ARM64。已发布版本比已安装版本新时，会点
亮桌面页签与侧边栏 `new` 标记；打开桌面页签即视为确认该已发布版本。

安装刻意做成两步，绝不静默：

1. 面板通过 Host 原生目录选择器让用户挑一个文件夹。取消会在任何下载发生之前结束流程。
2. Host 把官方安装包下载到该文件夹，然后启动它，由用户操作安装界面。macOS 上用 `open` 挂载
   `.dmg`，由用户把 app 拖进 `/Applications`。

只接受 `download.deepseek.com`，且只用上面那几个固定 URL——浏览器无法提供下载目标。下载失败
会删掉未完成的文件。

## 桌面快捷方式

工具栏的 **桌面快捷方式 / Desktop shortcut** 按钮会往用户桌面写一个启动器。它跟随**本次会话
是怎么启动的**，而不是这台机器上恰好装了什么客户端：装了桌面版 exe、但当前是 npx 跑起来的机
器，拿到的是 npx 启动器。判定读进程参数（`_npx/<hash>` 表示 npx 启动，Electron 运行时表示桌
面版，全局 `node_modules` 根下的路径表示 npm）；其余类型是当前安装不可达时的兜底顺序：

1. 启动本进程的那一类，
2. 其次桌面客户端，
3. 其次全局 npm 安装，
4. 其次已安装的 npx 副本，优先选本进程正在运行的那个目录。

Windows 上启动器是 `DeepSeek Harness.lnk`，目标是桌面版 exe、全局 `%APPDATA%\npm\dsh.cmd`，或
npx 的 `.bin\dsh.cmd`。macOS 上 CLI 安装得到 `DeepSeek Harness.command`——一个 `/bin/sh` 脚本，
用当前 node 执行该安装的 `lib/bin.js` 并带上保留下来的 profile 参数；桌面客户端则得到指向已
安装 app 包的 `DeepSeek Harness.app` 符号链接。`.command` 用终端图标，app 符号链接保留 app 自
己的图标。

Windows 上快捷方式使用插件自带的原始光泽版 `assets/tray.ico`（可用 `DSH_UPDATE_MANAGER_ICON`
覆盖）。它是从原始 `icon.png` / `tray.ico` 素材重建的多尺寸 `.ico`（BMP 帧加一张 256 px PNG）。
写 `.lnk` 之前，Host 会把这些字节复制到 `%LOCALAPPDATA%\dsh-update-manager\shortcut.ico`，让
`IconLocation` 指向那里：插件包内的副本位于 DSH 工作区下，其低完整性标签会让 Explorer 的快捷
方式图标提取器拒绝读取，AppData 里的副本则能正常渲染。插件目录由它自己的模块 URL 解析，因此
插件被复制到另一台机器时图标依然有效。源文件缺失时，快捷方式保留系统图标。

写入是幂等的：每次点击都重建同一个文件，用户删掉的快捷方式会回来，换成另一种启动类型则接管这
个名字。什么都没装、或桌面目录不存在时，Host 拒绝执行。保存 `.lnk` 之后，Host 会请求 shell 重读
这一项的图标（`SHChangeNotify(SHCNE_UPDATEITEM)`）：否则 Explorer 会一直用它为同名被重写的快捷
方式缓存的通用图标，永远不再重新提取 `.ico`。

对 CLI 启动，快捷方式携带正在运行的 profile 与启动参数（同样的 `web` / `--profile` / `--patch` /
应用参数，去掉 `--no-open`），并使用服务端的工作目录。Windows 上裸跑 `dsh.cmd` 会以
`error: --profile <name> is required` 退出，所以不带参数的快捷方式从来启动不了任何东西。首选目标
是带 `-NoExit` 的 PowerShell；命令以 base64 编码（`-EncodedCommand`）传入，让路径和参数绕开
命令行引号规则，启动错误也保持可见。没有 PowerShell 时直接以 `.cmd` 为目标，由 Windows 通过
cmd.exe 运行。桌面客户端仍然直接从它的 exe 启动。

面板的操作行位于标题下方，让标题独占一行：重新检查、桌面快捷方式、重启 DSH；一个分隔符，然后
是语言与打赏按钮。

## 语言

面板按用户时区自行选语言：属于中国大陆的 IANA 时区（`Asia/Shanghai`、`Asia/Chongqing`、
`Asia/Harbin`、`Asia/Urumqi`、`Asia/Kashgar`、`PRC`）用中文；其他所有时区——包括香港和澳门——用
英文。它不跟随应用的语言设置。

标着 `English` / `中文` 的头部按钮用来切换。手动选择优先于时区判断，并保存在 `localStorage` 里，
刷新和重启都保留。切换时会重新注册侧边栏条目，标签立即跟上。

## 打赏开发者

面板底部有一个按钮，点开一个对话框。中文面板显示随包提供的收款码 `assets/dashang.jpg`；Host 在
`/dsh-versions/tip-qrcode` 提供它，`TIP.qrcode` 指向这个同源路由。英文面板通过 `TIP.link` 在新标
签页打开 `https://paypal.me/ccsdyc`。PayPal 的页面拒绝被 iframe 嵌入，所以对话框里给的是按钮而
不是内嵌页。

## 更新标记

有可用更新时，侧边栏条目的标签后面会出现红色 **new**，区域切换器里对应的分段会出现红点。三个
区域都是拿已发布版本与已安装副本比较：npm 和 npx 用 registry 上最新的 rc/alpha；desktop 从安装
包的 `Content-Disposition` 文件名里解析已发布版本。检查在插件加载时跑一次，之后每小时整点再跑
一次。点击页签即确认该已发布版本，清掉它的红点；没有未确认的红点时，侧边栏的 `new` 一并消失。
确认记录保存在 `localStorage` 的 `dsh-update-manager:dismissed` 下；出现更新的已发布版本时红点会
再次亮起。这个标记是一张插件自有的样式表，作用在行的 `aria-label` 上；安装/卸载操作会立即重跑
检查。

## 扫描范围

所有存在的 npm 缓存根都会被检查（`npm_config_cache`、`%LOCALAPPDATA%\npm-cache`、
`%APPDATA%\npm-cache`、`~/.npm`）：

- `_npx/<hash>/package.json` → 已安装的 dsh 版本、目录占用，以及该安装的最后修改时间。
- `_cacache/index-v5` → 每一条 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 tarball 记录，按 dsh
  版本聚合，包括用户手工删掉 `_npx` 目录、只剩缓存的版本（显示为 **仅缓存 / cache only**）。
- 全局安装的 `@deepseek-ai/dsh` 构成 npm 区域。Windows 检查 `%APPDATA%\npm\node_modules` 与
  `%LOCALAPPDATA%\npm\node_modules`；macOS 与 Linux 还会检查当前 node 的 prefix
  （`<prefix>/lib/node_modules`）、`/usr/local`、`~/.npm-global`，以及 nvm/nodebrew/Volta/asdf/fnm
  的版本根；macOS 另查 `/opt/homebrew/lib/node_modules`。

## 最新版本

已发布版本取自配置的 npm registry（环境变量 `npm_config_registry`，其次 `~/.npmrc`，最后是公共默
认源），用精简版 packument 拉取，缓存五分钟。"最新 rc"和"最新 alpha"是按通道取最高 semver，所以
它们跟随 registry 的实际发布，而不是 `dist-tags`。

## 升级

- npm：`npm install --global @deepseek-ai/dsh@<version>`
- npx：`npx --yes @deepseek-ai/dsh@<version> --version` —— 它填充 npx 缓存后退出；不启动服务，也
  不删除旧副本，旧副本随后出现在"其他已安装版本"里。

两条命令都在 `PATH` 前面加上当前 node 的 bin 目录和常见 npm 安装位置，这样从 Finder 启动的 macOS
桌面 app 也能找到 Homebrew 或 nvm 的 npm。

安装进行中，面板显示带目标版本和转圈的阻塞式覆盖层；只换按钮文字会让人以为"什么都没发生"。覆盖
层还会说明装完后是否跟着重启。

同一时间只跑一个升级；版本在进入 shell 之前先与 registry 校验；每次安装限时 15 分钟。响应里带命
令输出的尾部，失败时可以直接读懂。

在 `npm install --global` 退出之前，升级独占安装目录。`npm` 会远早于依赖树就写好包本身和它的启
动脚本，所以 Host 在升级进行中拒绝重启（`error: 'upgrading'`），也会拒绝启动一个 `node_modules`
还缺已声明依赖的版本（`error: 'install-incomplete'`）。list 路由把正在进行的安装报成
`runtime.upgrading`，因此安装期间刷新过的页面会继续禁用重启和第二次升级，并轮询到安装结束。

升级当前进程正在运行的这份安装，必须重启进程才生效，所以面板会先确认再自动重启。升级另一个区域
只是装一份副本。

## 重启

面板只对 CLI 启动（npx 与 npm）提供重启，且只在启动器提供了 `ctx.appExit` 时提供；桌面 app 永不
通过这种方式重启。工具栏的 **重启 DSH** 按钮用同样的方式重启当前版本（桌面 app 下不可用），状态
行的 `重启到 <version>` 则切到较新的安装。Host 会：

1. 用本进程的 PID、工作目录和启动参数拉起一个脱离的助手进程；
2. 先应答请求，然后调用启动器的受限退出（`ctx.appExit(0)`）；
3. 助手等这个 PID 消失（20 秒宽限，之后强制终止），再等一秒，用同样的参数启动新安装的
   `node_modules/@deepseek-ai/dsh/lib/bin.js` —— web profile 会追加 `--no-open`，避免重启时又开
   一个标签页；
4. 页面轮询 `/dsh-versions/list`，只有当目标版本由一个**新的 PID** 报出时才重新加载——同版本重
   启不能在旧服务的应答上提前刷新。两分钟后覆盖层改为显示日志路径。

助手会对"在探测窗口内就退出"的启动按递增间隔重试（1、2、4、8、15，之后 30 秒），总共最长两分钟，
这样端口还没释放、或依赖树还在解包，都不会让机器上没有服务；它把自身消息和新服务的输出一起追加
到 `$DSH_HOME/logs/dsh-update-manager-restart.log`（macOS 回退到
`~/Library/Logs/dsh-update-manager/`，Windows 回退到 `%LOCALAPPDATA%\dsh-update-manager\`）。预算
用完时记一条 `giving up` 和最后一次的结果。会话是持久化的，但那一刻正在跑的 agent 轮次和后台任务
会被中断。

## 从 npm 安装

包名是 `dsh-update-manager`。用插件市场的安装动作，或者执行：

```powershell
dsh plugin --profile web add dsh-update-manager
```

如果 CLI 只加了依赖，请在重启前到插件管理器里启用这个 bundle。安装或更新后重启 DSH；Host 半边在
启动时加载，客户端 bundle 也在那时重新发布。

## 保护规则

- 最新的已安装版本永不提供删除按钮。
- 当前进程启动时所在的版本（从 `process.argv` 路径里的 `_npx/<hash>` 判定）同样永不提供删除。
- npm 区域完全不提供删除。

## 删除

- 安装行会删掉它的 `_npx/<hash>` 目录**以及**它的缓存条目。
- 仅缓存行只删缓存条目。
- 删缓存先删对应的 index 行，只有当没有任何剩余 index 条目再引用那个 integrity 时，才删除内容
  blob（blob 按内容寻址，可能与其他包共享）。如果某个 index 文件读不出或改不了，整个 blob 回收
  直接跳过。
- 每个动作都先确认，并报告释放的字节数。

## 传输

Host 半边把下列路由注册到组合的 `webServer` 上（`/dsh-versions/list`、`/dsh-versions/sizes`、
`/dsh-versions/registry`、`/dsh-versions/upgrade`、`/dsh-versions/restart`、
`/dsh-versions/delete`、`/dsh-versions/desktop`、`/dsh-versions/desktop/install`、
`/dsh-versions/shortcut`、`/dsh-versions/tip-qrcode`），每个都在 `connection.requestRejection` 之
后。Client 半边用同源 `fetch` 调用它们。`/list` 还带 `runtime`（类型、hash、启动时加载的版本、PID、
是否支持重启，以及正在进行的升级 `upgrading`——空闲时为 null）。列表在测量安装体积之前就返回；
体积由第二个请求补齐，所以即使缓存是冷的，面板也能在一秒左右画出来。

## 打包与可移植性

这个包是自包含的。`index.js` 只用 Node 内置模块，`client.js` 只用宿主提供的 React loader，
`package.json` 不声明任何 npm 依赖。运行时素材都在包内并列入 `files`：`assets/dashang.jpg`、
`assets/tray.ico`、`icon.svg`、`locale/*.json`、`cordis.patch.yml`、`LICENSE`、`README.md` 和
`README.zh.md`。Host 从自己的模块 URL 解析打赏二维码和快捷方式图标，所以复制或打包出来的目录放
在任何位置都能用。`dev/` 与 `tools/` 不在 npm `files` 列表里；zip 是整目录复制，所以那里两者都
有。

### Zip / 离线安装

把 `dsh-update-manager` 文件夹（文件夹本身作为 zip 根）压缩。在目标机器上：

1. 解压到任意位置，例如 `D:\dsh\dsh-update-manager`。
2. 完全退出 DSH。
3. Windows：双击 `install.cmd`；macOS/Linux：`sh install.sh`。
4. 重启 DSH 并刷新页面。

安装器会定位 `%DSH_HOME%`（或 `~/.dsh`）与 `web` profile，在 PATH 或 npx 缓存里找 `dsh`，执行
`dsh plugin --profile web add link:<folder>`，把 bundle 加进 profile，并创建本地包链接。找不到 CLI
时回退为直接建链接；`--no-cli` 强制走该模式。改动之前，它会把 profile 的 `package.json` 备份成
`package.json.dshvm-backup`。

选项：`--profile <name>`、`--dsh <path>`、`--dry-run`、`--no-cli`。

zip 只是传输方式，不是 DSH 的安装源；真正把文件夹注册进目标 profile 的是安装器。

### 插件市场（npm 源）

DSH 插件市场格式 1 接受 npm 与 Git 版本，不接受 zip。包名是 `dsh-update-manager`；生成一个以 npm
为源的自托管索引：

```powershell
node tools/make-market-index.mjs --version 1.1.0 --out market/index.json
```

该工具会内嵌 `icon.svg` 和 locale 描述，并打印 `dsh-update-manager@1.1.0` 的安装 spec。把
`index.json` 放到 HTTPS 静态主机上，再把该 URL 加到 DSH 的插件市场索引设置里。

若要用固定 commit 的 Git 发布，改为 `--source git --repo
https://github.com/ccsdyc/dsh-version-manager --commit <40-sha>`；插件不在仓库根目录时加
`--path <subdir>`。

运行时只要求兼容的 DSH 宿主、面板驱动的平台工具（`npm`/`npx`，Windows 上的 PowerShell，macOS 上的
`plutil`/`open`），以及访问 registry 和桌面安装包所需的网络。

## 开发

- `dev/probe-delete.mjs` 构造一个合成缓存根，断言删除规则（共享 blob 保留、最新版被拒、安装被移除）。
- `dev/probe-registry-logic.mjs` 检查 registry 应答，以及升级会拒绝非法 target、不安全版本串和未发
  布版本。
- `dev/probe-restart.mjs` 检查启动版本读取、启动计划，并用两个一次性 HTTP 服务验证脱离的助手。
- `dev/probe-restart-guard.mjs` 检查防止升级与重启抢跑的几道防线：安装进行中返回的拒绝、拒绝半写
  好的安装的依赖树检查、已完成安装的启动计划、助手的退避与放弃预算，以及面板读取的
  `runtime.upgrading` 字段与本地化键。
- `dev/probe-shortcut.mjs` 检查快捷方式参数、profile 保留，以及 PowerShell/command 调用构造。
- `dev/probe-macos.mjs` 在任意宿主上检查 macOS 专属决策：全局 npm 根、启动类型判定、Info.plist
  解析、app 包扫描、`.command` 脚本、安装包架构/Rosetta、PATH 与日志路径。
- `dev/probe-status.mjs` 用一个过期的 `.2` 进程、一个 `.3` 安装和一个进行中的升级渲染面板，断言状态
  行、重启动作、升级覆盖层，以及桌面版的已安装/最新版本与红点；它还点开"清理缓存"确认框，断言请
  求打到删除路由，并检查标题里的版本号。
- `dev/probe-tip.mjs` 在假 web 服务上挂载 Host，检查打赏二维码路由对 GET 和 HEAD 都返回随包 JPEG。
- `dev/probe-dots.mjs` 复刻区域更新规则：npm/npx 的已发布版本加上桌面版的已发布版本，以及侧边栏
  `new` 跟随两者。
- `dev/check-locales.mjs` 检查 `zh`/`en` 键是否对等。

Host 代码每个进程只导入一次，所以**改过 `index.js` 必须重启 DSH** 路由才会生效；刷新页面只会重载
浏览器半边。
