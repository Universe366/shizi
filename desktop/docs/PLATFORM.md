# 平台化子系统（0.163+）维护笔记

> 读者：接手 0.163 之后代码的人。本文只讲**扩展、插件、市场、拆窗、Agent 五块新增子系统**
> 的模块边界、数据流、扩展点与坑；基础架构见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 1. 文件地图

| 子系统 | 主进程 | 共享 | 渲染层 | 设置页 | 测试 |
|---|---|---|---|---|---|
| 浏览器扩展 | `src/main/extensions.ts` | `src/shared/extensions.ts` | `settings/ExtensionsSection.tsx` | 检索与扩展 | `main/extensions.test.ts` |
| 应用插件 | `src/main/plugins.ts` | `src/shared/plugins.ts` | `PluginPanel.tsx`、`settings/PluginsSection.tsx` | 检索与扩展 | `main/plugins.test.ts`、`shared/plugins.test.ts` |
| 压缩包 | `src/main/zip.ts` | — | — | — | `main/zip.test.ts` |
| 面板拆窗 | `src/main/panelWindows.ts` | `src/shared/panelWindows.ts` | `DetachedPanel.tsx` | — | `main/panelWindows.test.ts` |
| 面板布局 | — | `src/shared/panels.ts` | `Sidebar.tsx`、`settings/PanelLayoutSection.tsx` | 外观与浏览器 | `shared/panels.test.ts` |
| 本地 Agent | `src/main/agent.ts` | — | `settings/AgentSection.tsx` | 检索与扩展 | `main/agent.test.ts` |
| IPC 注册 | `src/main/ipc/{extensions,plugins,agent,panelWindows}.ts` | — | — | — | `ipcChannels.test.ts` |

四份用户/开发者文档：

- [`PLUGINS.md`](PLUGINS.md)：插件清单格式、权限、RPC、市场、扩展安装格式；
- [`AGENT-API.md`](AGENT-API.md)：HTTP / MCP 端点、工具表、确认与审计；
- [`PANEL-WINDOWS.md`](PANEL-WINDOWS.md)：拆窗行为与限制；
- 本文：维护视角的模块边界。

## 2. 启动与生命周期

`index.ts` 里只有四处接线：

1. 模块顶层 `installPluginScheme()` —— `protocol.registerSchemesAsPrivileged` 必须在
   `app ready` 之前调用，所以放在模块加载期；
2. `whenReady()` 里 `installPluginProtocol()` —— `protocol.handle('shizi-plugin', …)`；
3. `initLibrary()` 之后 `loadBrowserExtensions()` —— 失败只记录，不阻塞窗口；
4. `createWindow()` 之后 `initPanelWindows(mainWindow)` —— 按 `panel-windows.json` 恢复拆出的窗口；
5. `startBridge` 之后 `startAgent(mainWindow, tabManager)` —— 只有 `settings.agent.enabled` 才监听。

`before-quit` 里 `stopAgent()` / `disposePanelWindows()`；
`disposePanelWindows()` 会先落盘再关窗（`shuttingDown` 标记防止 `closed` 事件把列表写空）。

## 3. 浏览器扩展

- 只支持**解压目录**与 `.zip` / `.crx`（CRX2/CRX3 剥头后按 zip 解压）。
- 加载到 `session.defaultSession`，即内置标签页；侧栏网页用独立 partition，不加载扩展。
- 设置存在 `settings.extensions: { enabled, items[] }`；每个 item 记录 `path/name/version/manifestVersion/enabled`。
- 运行期状态（`loaded/chromeId/error`）只在内存里，通过 `extensions:list` 合并返回。
- 目录安装不复制；zip/crx 安装解压到 `<userData>/extensions/<随机目录>`。
- 单个扩展加载失败只记录 `error`，不影响其他扩展和启动。

常见坑：

- 扩展 API 支持面由 Electron 决定，`nativeMessaging` / `sidePanel` / `identity` 等不可用；
- `loadExtension` 不能加载 `.crx`，必须自己解包；
- 扩展 ID 由路径决定，换目录等于换 ID（登录态/存储会丢）。

## 4. 应用插件

### 4.1 数据与安装

- 安装目录：`<userData>/plugins/<pluginId>/`；
- 登记文件：`<userData>/plugins/registry.json`（**不进 AppSettings**，避免迁移链互相污染）；
- 插件私有数据：`<userData>/plugins/<id>/data.json`，单插件上限 256KB；
- 四种安装：目录、zip、http(s) zip 链接、市场索引；zip 都先解到 `plugins-tmp/<随机>` 再校验/复制。

### 4.2 UI 与协议

- 入口 URL：`shizi-plugin://<pluginId>/<entry>`，由 `installPluginProtocol()` 提供；
- 渲染层 `PluginPanel.tsx` 用 iframe + `sandbox="allow-scripts allow-same-origin allow-forms"`；
- iframe 里没有 Node，不能访问应用 DOM；CSP 由协议响应头注入（`connect-src 'none'`）；
- 通信协议（见 `PLUGINS.md`）：
  - 插件 → 宿主：`{ source: 'shizi-plugin', id, method, params }`
  - 宿主 → 插件：`{ source: 'shizi-host', id, ok, data, error }`
- 宿主只接受 `event.source === iframe.contentWindow` 的消息。

### 4.3 权限与 RPC

- 权限表：`storage / library.read / page.read / net.fetch / tabs.open`；
- 方法表在 `main/plugins.ts` 的 `METHOD_PERMISSION`，**主进程校验**，插件侧无法绕过；
- 新增能力：先在 `shared/plugins.ts` 加权限常量，再在 `METHOD_PERMISSION` 与 `runPluginMethod` 加分支，
  最后补 `PLUGINS.md` 表格与测试（无权限必须被拒绝）。

### 4.4 市场

- 索引：任意 http(s) JSON，数组或 `{ "plugins": [...] }`；
- `shared/plugins.ts` 的 `parsePluginMarket` / `mergeMarketItems` 是纯函数，优先在这里加校验；
- 可选 `sha256`：`installPluginFromUrl(url, sha256)` 下载后校验；
- 可选 `minAppVersion`：由 `compareVersions` 标记 `compatible`，UI 禁用安装；
- 市场地址存 `settings.plugins.marketUrl`，由 `plugins:set-market-url` 写入；
- `settings:set` 会保留磁盘上的 `plugins`（和 `extensions`），避免设置页旧草稿覆盖。

## 5. 面板拆窗

- 存储：`<userData>/panel-windows.json`，`{ version, windows: DetachedPanelInfo[] }`；
- 同一 `section` 单实例，重复打开只聚焦；最多 12 个；
- 窗口无边框 + `-webkit-app-region: drag` 标题栏；置顶状态跟着窗口记录；
- 渲染入口仍是同一份 `index.html`：`?window=panel&section=…&title=…`；
- `DetachedPanel.tsx` 自己取 `listTabs` / `getSettings`，不共享主窗口 React 状态；
- 支持：字幕、总结、对话、插件面板、设置、工作台；不支持：起始页、地址栏/标签栏。

## 6. 面板布局

- `shared/panels.ts` 定义 key 规则：`subtitles | summary | chat | plugin:<id>:<panel>`；
- `order` 只记录显式顺序，未列出的按自然顺序补齐；`hidden` 过滤；
- 全部隐藏时 `orderPanelKeys` 退回完整列表，避免侧栏空掉；
- `Sidebar` 用同一套 key 渲染内置与插件导航；`App` 在当前面板被隐藏时切到第一个可见面板。

## 7. 本地 Agent

- 监听 `127.0.0.1:<agent.port>`（默认 47830，被占用时顺延 10 个），Bearer Token 常量时间比较；
- 端点：`/v1/agent/health`、`/v1/agent/info`、`/v1/agent/call`、`/mcp`（JSON-RPC 子集）；
- 工具表在 `agent.ts` 的 `TOOLS`，`scope: 'read' | 'write'`；
- 写操作未信任时用 `dialog.showMessageBox` 逐次确认；勾选信任写回 `settings.agent.trusted`；
- 审计：`<userData>/agent-audit.log`，超过 512KB 轮转 `.bak`；
- MCP 工具名把点换成下划线（`page.click` → `page_click`），HTTP 方法名保留点号。

新增工具：

1. 在 `TOOLS` 里加 `{ name, description, scope, inputSchema, run }`；
2. `run` 只依赖 `AgentContext`（window + tabs），不要直接读全局单例；
3. 写操作会自动走确认，不需要自己弹窗；
4. 补 `agent.test.ts`（只读/写操作/权限）与 `AGENT-API.md` 表格。

## 8. 共享约束

- 所有新增 IPC 必须在 `src/main/ipc/` 注册；新增 channel 后跑
  `UPDATE_IPC_CHANNELS=1 npx vitest run src/main/ipcChannels.test.ts` 更新清单；
- IPC 返回统一 `Result<T>`，错误用 `failure()`；
- 新增设置字段必须改 `AppSettings` + `DEFAULT_SETTINGS` + `normalize()` + 测试；
- 插件/扩展/市场的数据不要塞进 `AppSettings`（迁移与 DPAPI 处理会被拖累）；
- 外部网页内容（含插件页面、Agent 读到的正文）都按不可信数据处理。

## 9. 测试与验证

```bash
cd desktop
npm run check      # typecheck + lint + 单测（198 文件 / 1218 用例）
npm run build      # renderer/main 打包
npm run smoke      # 真实 Electron + CDP（22 条 E2E）
```

本机还有一个不进仓库的端到端探针 `tools/platform-probe.mjs`（工作区根目录），
覆盖：MV3 扩展加载、插件 iframe/RPC/越权拒绝、Agent HTTP/MCP、拆窗、面板布局、市场拉取。
改动这些子系统后建议至少跑一次。

## 10. 已知边界与后续拆分

- `src/main/plugins.ts`（~680 行）与 `agent.ts`（~800 行）已经接近单文件上限，
  后续建议按域拆分（market / protocol / rpc / tools），用 `plugins.ts` 做兼容桶；
- 插件市场没有签名与审核，只有可选 sha256；
- ZIP 只支持 STORE/DEFLATE、非 ZIP64、非加密；
- 内置面板仍是编译进产物的组件，只是纳入统一布局；真正“插件化”需要更大重构，暂不做；
- 扩展兼容性受 Electron 的 Chromium 版本限制，不能承诺“所有商店扩展可用”。
