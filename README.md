# 拾字 / Shizi

<div align="center">
  <img src="docs/banner.png" alt="拾字" width="100%" />
  <p><b>B 站字幕 → 语音转录 → AI 笔记 → 本地库。</b></p>
  <p>浏览器插件 + Windows 桌面端；本地优先，数据留在自己电脑。</p>
</div>

<p align="center">
  <a href="https://github.com/Universe366/shizi/releases"><img src="https://img.shields.io/github/v/release/Universe366/shizi?sort=semver&display_name=tag" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Universe366/shizi" alt="License" /></a>
  <img src="https://img.shields.io/badge/Windows-Desktop-0078D7" alt="Windows Desktop" />
  <img src="https://img.shields.io/badge/Electron-45-47848F" alt="Electron 45" />
  <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/SQLite-local-003B57" alt="SQLite" />
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4" alt="Manifest V3" />
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能">功能</a> ·
  <a href="#界面预览">界面</a> ·
  <a href="#插件与桌面端">插件与桌面</a> ·
  <a href="#开发与测试">开发</a> ·
  <a href="#架构">架构</a> ·
  <a href="#隐私">隐私</a> ·
  <a href="https://github.com/Universe366/shizi/releases">下载</a>
</p>

> 非官方项目，与哔哩哔哩无关联。自有代码 MIT；内置 FFmpeg core 按 GPL 分发，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

当前版本：**桌面 0.162.25 / 插件 2.20.14**。

## 为什么做这个

B 站视频的字幕、音轨、评论和简介散在不同接口里，想整理成一份能用的笔记通常要来回切换工具。拾字把它们收进一个地方：

- 有官方字幕就直接抓，没有就**语音转录**；
- 转写后可以 AI 校对、翻译、断句、生成章节和总结；
- 总结、对话、笔记、字幕进入**本地库**，可以搜索、追问、导出；
- 需要外部信息时，总结会按需联网检索，并把参考网址列出来。

## 快速开始

### 桌面端（推荐）

1. 从 [Releases](https://github.com/Universe366/shizi/releases) 下载：
   - 安装版 `shizi-setup-0.162.25.exe`
   - 绿色版 `shizi-0.162.25-win-x64-green.zip`
2. 打开「设置 → AI 与模型」：选择平台、填写 Base URL、模型和 API Key，点「测试连接」。
3. 打开 B 站视频，在侧栏抓字幕、总结、对话；没有字幕就点「转写」。

> 安装包未签名，Windows SmartScreen 会提示，这是已知状态。

### 浏览器插件

1. 下载 `shizi-extension-v2.20.14.zip` 并解压。
2. Chrome / Edge 打开 `chrome://extensions`，开启「开发者模式」→「加载已解压的扩展程序」。
3. 打开 B 站视频，右侧出现「拾字」面板；设置都在侧边栏完成。

### 插件 + 桌面一起用

- 插件会自动发现本机桌面端；
- 首次连接可选择「以桌面端为准」或「以插件端为准」；
- 设置、API Key、历史库、对话可双向迁移；
- 桌面在线时默认优先用桌面执行，失败回退插件本地；
- 也可在设置里选择「仅插件」或「优先桌面」。

## 功能

### 字幕与播放

| 能力 | 说明 |
|---|---|
| 字幕抓取 | WBI 签名接口优先；身份校验（bvid / cid / signature）；身份不符时宁可无字幕 |
| 选轨 | WBI > 播放器 > 初始/嗅探；当前/中文优先、人工轨优先；按视频记住手动选轨 |
| 多语言 | 多轨切换；翻译保留原文，支持原文 / 译文 / 双语 |
| 跟随播放 | 逐句高亮、自动滚动；拖动进度条后会重新定位 |
| 语音转录 | 在线 ASR，或连接桌面时使用本地 whisper.cpp |
| 字幕编辑 | 导入 SRT / VTT / JSON；规则断句；AI 优化/校对；替换规则 |
| 导出 | SRT / VTT / ASS / TXT / Markdown / JSON；6 格式 × 4 模板 |

### AI 与总结

| 能力 | 说明 |
|---|---|
| 模型平台 | 35 个 AI 平台预设；OpenAI 兼容、Anthropic、Gemini 原生、Azure OpenAI、Ollama、LM Studio |
| 按任务选模型 | 总结 / 对话 / 翻译 / 校对 / 章节 / 文字识别 / 语音朗读 / 图片生成可分别指定平台与模型 |
| 总结 | 与桌面端共享提示词/格式规则/术语表；官方分段优先；对话式联网工具循环 |
| 总结展示 | 流式 Markdown、思考过程折叠、[n] 引用、KaTeX 公式、参考网址、失败重试 |
| 对话 | 基于字幕/页面提问；工具调用；上下文压缩；对话历史 |
| 检索 | DeepSeek / Tavily / 博查 / Serper / 智谱 / 秘塔 / 千帆 / Brave / Exa / Firecrawl / Querit / Jina / SearXNG |
| MCP | HTTP / SSE；工具审批（不询问 / 写操作前 / 每次）；工具循环 |
| Skills | SKILL.md 单文件 / 文件夹 / 链接导入；指令型技能 |
| 图片生成 | OpenAI 兼容（OpenAI / 硅基流动 / LocalAI）、本地 SD WebUI、本地 ComfyUI 工作流 |
| 文字识别 | Windows OCR / PaddleOCR / 视觉大模型 |

### 桌面端

- 多标签内置浏览器、垂直标签栏、标签组、会话恢复、阅读模式、收藏与历史；
- 地址栏搜索、起始页、网页倍速、画中画、弹幕与评论；
- 桌面宠物、快捷轮盘、全局截图/OCR、文件转换；
- 本地 SQLite：`library.db`、`chat.db`、`usage.db`；
- 一键备份/恢复，数据目录可迁移。

### 插件端

- 五个入口：**字幕 / 总结 / 对话 / 库 / 设置**；
- 设置 8 个顶层分组；共享设置与桌面端双向迁移；
- 库页可查看桌面库、回写总结/笔记/标签/合集；
- 对话页支持当前视频对话与历史会话预览；
- 独立运行也使用新总结流程，不依赖桌面端。

## 界面预览

<table>
  <tr>
    <td width="62%"><img src="docs/screenshots/desktop-sidebar.png" alt="桌面端侧栏" /></td>
    <td width="38%"><img src="docs/screenshots/settings-page.png" alt="设置页" /></td>
  </tr>
  <tr>
    <td align="center">桌面端侧栏：字幕、总结、对话与库</td>
    <td align="center">设置页：分组与分区说明</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/start-page.png" alt="起始页" /></td>
    <td><img src="docs/screenshots/vertical-tabs.png" alt="垂直标签栏" /></td>
  </tr>
  <tr>
    <td align="center">起始页：快捷方式 / 热搜 / 天气</td>
    <td align="center">垂直标签栏：分组、搜索、预览</td>
  </tr>
</table>

插件在 B 站视频页的形态：

<img src="docs/screenshots/embed-panel.png" alt="插件内嵌面板" width="100%" />

## 插件与桌面端

| 项 | 插件 | 桌面 |
|---|---|---|
| 独立运行 | 是 | 是 |
| 总结新流程 | 共享 core | 共享 core |
| 执行宿主 | 本地 / 桌面 | 本地 |
| 设置主端 | 可选 | 可选 |
| 迁移 | 设置 + 历史库 + 对话 | 同 |
| MCP | HTTP / SSE | HTTP / SSE / stdio |
| UI | 顶部五入口 | 侧边栏 |

已知限制：

- 浏览器扩展不能运行本地 `stdio` MCP；
- 插件与桌面视觉布局未逐像素一致；
- 插件 AI 平台不保存桌面 DPAPI 加密的 Key，迁移时按用户选择复制。

更细的差异与验收项见 [docs/EXTENSION-DESKTOP-ALIGNMENT.md](docs/EXTENSION-DESKTOP-ALIGNMENT.md)。

## 开发与测试

```bash
# 桌面端
cd desktop
npm ci
unset ELECTRON_RUN_AS_NODE   # Windows 本机若为 1，必须先清掉
npm run dev
npm run check                # typecheck + lint + 单测
npm run verify               # check + 真实 Electron 冒烟
npm run pack                 # 构建 + 同步插件 + NSIS（不发布）
```

```bash
# 插件
cd verify
npm ci
node bundle.js
node panel-test.js
node browser-smoke-test.js   # 需要本机 Edge/Chrome + 网络
```

环境：Node 24.x（`node:sqlite` 需要 22+）。

当前基线：

- 桌面：180 个测试文件 / 1075 个用例（1 跳过）；冒烟 E2E 19/19；
- 插件：panel-test 478 项；真实浏览器冒烟 13 项；
- 发布：tag 触发 GitHub Actions，构建安装版、绿色版与插件 zip。

## 架构

```
desktop/
├─ src/main/        Electron 主进程：窗口/标签/桥/库/AI/ASR/OCR/TTS/MCP
├─ src/preload/     contextBridge API（window.bsub）
├─ src/renderer/    React：Sidebar / Subtitles / Summary / Chat / Library / Settings
├─ src/shared/      跨进程类型、品牌、预设、共享 core
├─ scripts/         构建、同步、发布、冒烟；mocks/ 下为本地 AI/ASR/MCP mock
└─ docs/            架构、桥协议、平台说明、加固记录

shizi-extension/
├─ src/background/  service worker：RPC、平台调用、MCP、工具循环
├─ src/content/     page-bridge（MAIN）+ content（ISOLATED）
├─ src/sidepanel/   面板 UI 与业务逻辑
├─ src/shared/      设置、常量、共享 core 生成物
└─ vendor/          FFmpeg.wasm、KaTeX
```

- `main` 不 import `renderer`；渲染层只能通过 `preload` 暴露的 `window.bsub` 调主进程。
- 新增 IPC 放 `src/main/ipc/<domain>.ts`，`ipc.ts` 只保留注册入口。
- 数据库改动走 `src/main/migrations.ts`，用 `PRAGMA user_version` 顺序迁移。
- 字幕只信 WBI 签名接口，详细原因见 [desktop/docs/ARCHITECTURE.md](desktop/docs/ARCHITECTURE.md)。

更多文档：

| 想知道 | 读 |
|---|---|
| AI / 维护者接手 | [AGENTS.md](AGENTS.md)、[HANDOFF.md](HANDOFF.md) |
| 桌面端分层与坑 | [desktop/docs/ARCHITECTURE.md](desktop/docs/ARCHITECTURE.md) |
| 设置页 / 对话输入区 | [docs/UI-GUIDE.md](docs/UI-GUIDE.md) |
| 数据库表、迁移与备份 | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) |
| 插件 ↔ 桌面通信 | [desktop/docs/BRIDGE.md](desktop/docs/BRIDGE.md) |
| 插件与桌面差异 | [docs/EXTENSION-PARITY.md](docs/EXTENSION-PARITY.md) |
| 插件与桌面架构 | [docs/EXTENSION-DESKTOP-ALIGNMENT.md](docs/EXTENSION-DESKTOP-ALIGNMENT.md) |
| 插件重构计划 | [docs/EXTENSION-REFACTOR-PLAN.md](docs/EXTENSION-REFACTOR-PLAN.md) |
| 发布 / 签名 / 更新 | [docs/MAINTAINERS.md](docs/MAINTAINERS.md) |
| 质量基线与重构顺序 | [docs/QUALITY.md](docs/QUALITY.md) |
| 遇到故障 / 更新失败 | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| 全部文档索引 / 历史归档 | [docs/README.md](docs/README.md) |

## 隐私

- API Key 在桌面端用 Windows DPAPI 加密后保存在本机；插件端按浏览器存储能力保存，迁移需用户确认。
- 字幕、总结、对话、笔记、用量默认在本机，不上传。
- 只有主动触发总结/对话/检索/embedding 时，才会把相应文本发给你配置的服务商。
- 网页文本一律按不可信资料处理，不执行页面里的指令。

## 版本

- 桌面端：**0.162.25**（2026-10-31）
- 插件：**2.20.14**
- 变更记录：[desktop/CHANGELOG.md](desktop/CHANGELOG.md)、[shizi-extension/CHANGELOG.md](shizi-extension/CHANGELOG.md)

## License

自有代码 MIT，见 [LICENSE](LICENSE)。FFmpeg.wasm、KaTeX 等第三方组件按各自许可证分发，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
