# 插件 ↔ 桌面端对齐方案（v2）

> 状态：核心对齐已落地（连接 / 数据 / AI / 语音 / 导出）；剩余为增强项，见第 13 节验收矩阵  
> 适用版本：桌面 0.161.0 / 插件 2.19.0  
> 相关：[BRIDGE.md](../desktop/docs/BRIDGE.md)、[ARCHITECTURE.md](../desktop/docs/ARCHITECTURE.md)、[SUMMARY-FLOW.md](../desktop/docs/SUMMARY-FLOW.md)

## 1. 结论先行

桌面端已经是**修正后的目标实现**，插件是更早的分支。对齐不能靠继续复制代码，
而要分三层解决：

1. **连接层**：插件自动发现本机桌面端，建立「上报 + 下发」双向通道，用户不点按钮；
2. **数据层**：以视频 `uid`（`v:bvid:cid` / `e:epId:cid` / `u:url`）为全局主键，
   桌面库为权威源，插件保留本地镜像与离线队列，重连后增量同步；
3. **能力层**：插件把 AI / ASR / TTS / 检索 / MCP / 提示词等重活**委托**给桌面端
   （行为天然一致）；桌面端不在时回退到插件本地实现，保证独立可用。

这样「装了桌面端 → 能力增强且行为一致」「没装 → 插件照常工作」，不需要维护两套 UI 逻辑。

## 2. 现状与差距

### 2.1 连通方式

| 维度 | 现状 | 问题 |
|---|---|---|
| 发现 | `GET /v1/hello` 扫 47821–47830 | 只在「发送到桌面」时触发，平时不知道桌面在不在 |
| 上行 | 用户点「⋯ → 发送到桌面」→ `POST /v1/ingest` | 需要手动；不 push 就永远不同步 |
| 下行 | 无 | 桌面端无法通知插件；插件无法读到桌面库 |
| 失败处理 | 每次点击临时重试 | 没有离线队列，关掉桌面端期间的数据不会补传 |
| 鉴权 | Bearer Token + 回环地址 | 可用；但 `/v1/hello` 对本机任意进程发 Token，需收紧 |

### 2.2 数据

| 数据 | 桌面端 | 插件 | 差距 |
|---|---|---|---|
| 视频/字幕 | `library.db` videos/tracks/segments | IndexedDB `history` | 字段、生命周期不同；无同步游标 |
| 总结 | summaries + 20 个版本 | history 里一个字符串 | 插件无版本；桌面无插件来源标记 |
| 笔记/标签/合集 | 有 | 无 | 插件不可见 |
| 对话 | chat.db（会话/分支/工具记录） | 仅内存 + 最近消息 | 插件刷新即丢 |
| 用量 | usage.db（token/按天/模型） | 无 | 插件调用桌面 AI 时可统一计量 |
| 设置 | settings.json | chrome.storage | 两套 AI/Search/ASR 配置，用户要配两遍 |

### 2.3 功能/流程

桌面端 0.161.0 已改成：

- 总结只有一条链路：`buildSummaryChatPrompt` + `chat()` 工具循环（联网检索/读网页），**不再分段、不再前置逐条核对**；
- 官方分段优先，提示词模板/格式规则/术语表可编辑；
- 轨道选择按「时长对齐 → 覆盖率 → 标题/简介关键词」校验，不合格直接拒绝；
- 任务中心、导出记录、库检索、笔记版本、合集对比、用量统计。

插件仍是：

- 「先联网校对字幕 → 再总结」，长视频走 map-reduce 分段；
- 自己的提示词、自己的检索编排、自己的历史记录；
- 没有任务中心/库/笔记/合集/用量。

**结论**：插件不能只改文案，必须把「总结/对话/字幕校验/导出」这些共享流程
收口到同一套定义，否则两边会继续漂移。

## 3. 目标与非目标

### 目标

1. 双向、无感：不点按钮也能自动上报、自动接收桌面状态；
2. 插件独立：没有桌面端时功能完整，不出现「必须装桌面端」；
3. 功能对齐：共享流程以桌面端为准；
4. 数据互通：字幕、总结、笔记、标签、合集、历史双向可见（按权限）；
5. 桌面增强：插件可直接使用桌面的 AI/ASR/TTS/检索/MCP/模型与 Key，不必重复配置。

### 非目标

- 不把桌宠、桌面浏览器、截图/OCR 等桌面专属能力搬进插件；
- 不把 API Key / Cookie 从桌面端下发给插件；
- 不重写桌面端；不改 `appId`、不打断自动更新。

## 4. 总体架构

```
┌─────────────────────────── 浏览器（插件） ───────────────────────────┐
│  sidepanel（字幕 / 总结·对话 / 库 / 设置）                             │
│      │ chrome.runtime RPC                                            │
│  service worker（后台 RPC、页面桥、任务）                             │
│      │                                                              │
│  desktop-link（发现 / 连接状态 / 上行队列 / 下行轮询）                  │
└──────┼──────────────────────────────────────────────────────────────┘
       │  127.0.0.1  HTTP（Bearer Token，仅扩展 Origin）
┌──────▼────────────────────────── 桌面端 ─────────────────────────────┐
│  bridge/server   /v1/hello /v1/events /v1/pull /v1/rpc /v1/sync/*     │
│  bridge/ingest   事件 → library.ingestVideo / saveSummary / saveNote  │
│  bridge/sync     变更游标、实体快照、墓碑                              │
│  bridge/capabilities  AI / ASR / TTS / search / MCP / settings        │
│  library.db / chat.db / usage.db                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**权威源规则**

- 装了桌面端：桌面 `library.db` 为权威；插件是「本地镜像 + 离线队列」；
- 没装桌面端：插件 IndexedDB 为权威；首次连上桌面时整库导入（可关）；
- 设置：AI/Search/ASR/MCP 以桌面为权威，插件只保留「本机覆盖」；Key 永远不下发。

## 5. 协议 v2

### 5.1 发现

`GET /v1/hello`（无需鉴权，仅扩展 Origin 或本机进程）

```json
{
  "ok": true, "app": "shizi", "name": "拾字",
  "protocol": 2, "minProtocol": 2,
  "version": "0.161.0",
  "instanceId": "uuid",
  "port": 47821, "token": "…",
  "capabilities": ["ingest", "events", "pull", "sync", "ai.chat", "ai.summarize", "asr", "tts", "search", "mcp", "settings.read", "library.read"]
}
```

库统计放在 `GET /v1/health`（`library.videos` / `library.segments`），发现接口不查库。
当前 M1 实际只声明 `ingest` / `events` / `pull` / `library.read`；其余能力在对应里程碑上线后
才加入 `capabilities`，插件**只按声明调用**，不按版本号猜。

- `Cache-Control: no-store`；
- Origin 不是 `chrome-extension://` / `moz-extension://` 且非空 → 403，不返回 Token；
- 端口顺延 47821–47830，插件缓存 30 秒，失败指数退避（1s→30s）。

### 5.2 上行事件（插件 → 桌面）

`POST /v1/events`（Bearer）

```json
{
  "protocol": 2,
  "client": { "id": "extension-id", "browser": "edge", "version": "2.19.0" },
  "events": [
    {
      "id": "uuid",
      "type": "history.upsert",
      "at": 1761740000000,
      "payload": {
        "video": { "bvid": "BV…", "cid": 1, "title": "…", "owner": "…", "duration": 100, "url": "…", "signature": "…" },
        "track": { "lan": "ai-zh", "lanDoc": "中文（AI）", "source": "extension", "isAi": true },
        "lines": [{ "start": 0.1, "end": 1.2, "text": "…" }],
        "summary": "可选的 Markdown",
        "model": "deepseek-chat"
      }
    }
  ]
}
```

响应：

```json
{ "ok": true, "results": [ { "id": "uuid", "ok": true, "videoId": 1, "lineCount": 240, "summarySaved": true } ] }
```

事件类型：

| type | 作用 | 必需字段 |
|---|---|---|
| `history.upsert` | 字幕 + 总结一次写入（插件保存历史时自动发） | video / lines |
| `video.captured` | 仅字幕 | video / lines |
| `summary.saved` | 仅总结 | video / summary |
| `note.saved` | 笔记 | video / note |
| `page.context` | 当前页面正文/选中（供桌面对话使用） | url / title |

- 幂等：`id` 去重（桌面保留 7 天，内存 + 可选表）；
- 批量最多 50 条 / 20MB；
- 失败逐条返回，插件保留队列重试；
- `/v1/ingest` 保留兼容，内部转成 `history.upsert`。

### 5.3 下行（桌面 → 插件）

`GET /v1/pull?since=<seq>&wait=25000`（Bearer）

```json
{
  "ok": true, "cursor": 42, "reset": false,
  "events": [
    { "seq": 41, "type": "library.changed", "payload": { "uids": ["v:BV1…:1"] } },
    { "seq": 42, "type": "settings.changed", "payload": { "domains": ["ai"] } }
  ]
}
```

- `wait` 最长 25s 的长轮询；没有事件时超时返回空数组；
- `since` 早于环形缓冲（保留最近 500 条）→ `reset: true`，插件全量拉一次；
- 桌面端重启后 `seq` 重置，插件按 `instanceId` 判断并 reset；
- 插件在侧边栏打开时维持轮询；后台 SW 只在有页面事件时补一次，避免 MV3 生命周期问题。

### 5.4 能力调用（插件 → 桌面）

统一 `POST /v1/rpc`（Bearer）：

```json
{ "protocol": 2, "method": "ai.chat", "params": { "task": "chat", "messages": [] }, "stream": true }
```

- 非流式返回 `{ ok, data }`；
- `stream: true` 返回 NDJSON：`{"type":"delta","text":"…"}` / `{"type":"tool",…}` / `{"type":"done","usage":…}`；
- 取消：请求头 `X-Shizi-Abort` 或断开连接（服务端监听 `close` 并 abort）；
- 方法按能力声明暴露，未声明返回 404，不靠版本号猜。

首批方法：

| method | 说明 |
|---|---|
| `ping` | 健康检查 |
| `settings.read` | 返回**脱敏**设置（AI 平台名/模型/任务槽位，不含 Key） |
| `ai.chat` | 走桌面 `chat()`，支持工具/联网/流式 |
| `ai.summarize` | 走桌面 `summaryChat`（与桌面总结完全一致） |
| `asr.transcribe` | 桌面本地 whisper.cpp / 在线 ASR |
| `tts.speak` | 桌面 TTS |
| `search.query` | 桌面检索平台（含 Keyless 兜底） |
| `library.search` | 搜桌面库（标题/字幕/总结/笔记） |
| `library.item` | 读条目详情 |

### 5.5 数据同步

`GET /v1/sync/changes?since=<cursor>&limit=200` → 变更列表（实体 + uid + op + updatedAt + rev）

`GET /v1/sync/entity?entity=video&uid=…` → 完整快照（含 tracks / summary / note / tags / collections）

`POST /v1/sync/push` → 插件上行实体（带 `baseRev`），返回 accepted / conflict。

实体与主键：

| entity | 主键 | 说明 |
|---|---|---|
| video | uid | 元数据、kind、source |
| track | uid + lan + source | 字幕轨（lines 随实体） |
| summary | uid | Markdown + model + updatedAt（版本另同步） |
| note | uid | Markdown + 版本 |
| tag | name | 名称即主键 |
| collection | name | 名称即主键；items = uid 列表 |
| chat | sessionId | 会话与消息（后续） |

冲突规则：

- 每个实体带 `rev`（整数）与 `updatedAt`（ms）；桌面端写入 `rev+1`；
- 推送带 `baseRev`：相等则接受并 `rev+1`；不等则返回 `conflict` + 当前实体；
- 插件默认采用「桌面优先」：冲突时弹一次选择，默认保留桌面；
- 删除用墓碑 `{deleted:true, deletedAt}`，保留 30 天；
- 字幕正文按轨整体同步（不按行 diff），用内容哈希去重。

游标：

- 桌面 `change_log` 表（seq 自增）记录所有实体变更；
- 插件保存 `cursor` 到 IndexedDB `syncMeta`；
- 首次连接：如果插件本地库非空且桌面为空 → 提示导入；否则以桌面为准合并。

## 6. 能力矩阵

| 能力 | 仅插件 | 连接桌面后 |
|---|---|---|
| 抓字幕 | 插件页面桥（WBI 优先） | 不变；可回传桌面入库 |
| 语音转录 | 插件自带（浏览器解码 + 在线 ASR） | 优先桌面本地 whisper / 在线 ASR |
| 总结 | 插件本地提示词 + 工具循环 | **桌面 `summaryChat`**（完全一致） |
| 对话 | 插件本地（含 MCP/检索） | 桌面 `chat()`（工具、审批、用量） |
| 检索 | 插件自有平台 | 桌面检索平台与缓存 |
| TTS | 插件 Edge/SAPI 能力有限 | 桌面 TTS（SAPI/OpenAI/Edge） |
| 模型/Key | 插件自己配置 | 用桌面配置，**Key 不下发** |
| 库 | 插件历史 | 桌面完整库（只读/可编辑按权限） |
| 用量 | 无 | 桌面统一计量 |

## 7. 分阶段实施

### M1 连接层（本次开始）

- 桌面：`/v1/hello` 升级 protocol/capabilities/instanceId；新增 `/v1/events`；保留 `/v1/ingest`；环形事件缓冲 + `/v1/pull`。
- 插件：新增 `desktop-link.js`（发现缓存、状态、离线队列、自动上报）；保存历史/总结后自动入队；顶部状态点；设置页状态与开关。
- 验收：不点按钮保存字幕 → 桌面库出现该视频；关闭桌面端后保存 → 重开桌面端自动补传；状态点正确。

### M2 数据层

- [x] 插件 IndexedDB 增加 `desktopLibrary` / `desktopOutbox` 镜像与队列；
- [x] 桌面 `/v1/library/items` + `/v1/library/item`，插件「库」页展示桌面库（只读）；
- [x] 插件历史 → 桌面：保存后自动事件推送、离线补传；
- [ ] 桌面库变更 → 插件增量：`change_log` + `/v1/sync/*`（当前是全量列表拉取）；
- [x] 插件编辑回写桌面：总结/笔记（带 `baseUpdatedAt`，冲突返回 409，不覆盖）；
- [x] 标签/合集回写（整组替换，详情浮层可编辑）；
- [x] 增量同步：`/v1/library/changes`（按 ms 游标）+ 回收站墓碑；首次仍走全量快照。
- 验收：两端各改一条总结，重连后收敛；删除后不再复活；离线编辑可补传。

### M3 AI 对齐

- [x] `/v1/rpc` NDJSON 流式；`settings.read` / `ai.summarize` / `ai.chat`；
- [x] 插件总结/对话优先走桌面端；桌面 AI 未配置/未连接时回退本地；
- [x] 桌面端可用时跳过插件本地「先校对」「长视频分段」主路径；
- [x] 插件设置显式提供「桌面 AI / 本地 AI」开关；
- [x] 桌面总结返回的「外部资料」在插件总结下方展示；
- [x] 总结「朗读」：桌面 TTS 优先，失败/未连接回退浏览器语音；
- [ ] 提示词/格式规则/术语表以桌面为唯一来源（当前由桌面端整条执行，插件不再拼提示词）；
- [x] MCP 审批：`ai.chat` 流里的 `approval` 事件 + `/v1/rpc/approval`，120 秒未决定按拒绝；
- [x] 插件对话按视频持久化（IndexedDB，最多 60 条），刷新/关闭面板后恢复；
- [x] 对话历史同步到桌面 `chat.db`（按视频 key 整段替换，重复同步幂等）。
- 验收：同一视频同一模型，插件与桌面总结的提示词哈希一致；流式/取消/用量一致。

### M4 字幕/语音/导出对齐

- [x] 页面桥读取 B 站官方分段 `view_points`：桌面总结按官方章节组织，插件本地总结也带官方分段并直接展示为章节；
- [x] 桌面本地 Whisper 可用时，插件把 WAV/M4A 分片发给桌面识别（失败自动回退在线 ASR）；
- [ ] 轨道校验阈值与「标题/简介关键词」判定与桌面共用；
- [x] 导出走桌面 `buildExport`（连接时与桌面字节一致；未连接用插件本地实现）；
- [x] 翻译走桌面 `translateLines`（连接时与桌面分批/术语表一致；失败回退插件本地）；
- [x] 校对/优化走桌面 `optimizeLines`（建议按桌面口径生成；失败回退插件本地）；
- ASR 优先桌面本地 whisper；失败回退插件在线 ASR；
- 任务中心：插件批量任务映射到桌面 jobs（可选）。
- 验收：同一视频两端选轨结果一致；导出文件字节级一致（同设置）。

### M5 收口

- 迁移/兼容/文档/测试；发布说明；灰度开关；
- 无桌面端回归（断网、未安装、端口占用、Token 失效）。

## 8. 安全与隐私

- 只监听 `127.0.0.1`；`/v1/hello` 仅扩展 Origin 可读 Token；
- 所有其它端点 Bearer Token；Token 只在内存/设置中，不写日志；
- 插件不能读桌面 API Key；`settings.read` 返回脱敏结构；
- `/v1/rpc` 只白名单方法，禁止任意 IPC 转发；
- 页面正文作为**不可信资料**，提示词中明确标注；
- 事件体上限 20MB，批量 50 条；按客户端限流（每分钟 120 次）；
- 桌面端可随时关闭「本机接收」，插件回到纯本地模式。

## 9. 兼容与迁移

- 协议版本：`protocol: 2`，保留 v1 字段（`app`/`version`/`port`/`token`）与 `/v1/ingest`；
- 插件旧版本连新桌面：仍能 `/v1/hello` + `/v1/ingest`；
- 新插件连旧桌面：`protocol` 缺失 → 只做 v1 推送，不调用 v2 能力；
- 数据迁移：IndexedDB v1 → v4 只加 store（history / outbox / desktopLibrary / chatHistory），不删旧数据；
- 桌面 `library` schema 改动只走 `migrations.ts`，v5 增加 `change_log` / `bridge_events`（若需要持久化）。

## 10. 测试策略

- 桌面：`bridge.test.ts`（协议纯函数/事件映射/鉴权/批量/冲突）、`sync.test.ts`、现有 `npm run check` / `smoke`；
- 插件：`verify/desktop-link-test.mjs`（发现缓存、队列、幂等、失败重试）、现有 `panel-test.js`；
- 联调：`desktop/scripts/mocks/bridge-test.mjs` 扩展为 v2 全链路（events → library → pull → rpc）；
- 手工：装/不装桌面、断网、端口占用、Token 轮换、双开。

## 11. 风险

| 风险 | 应对 |
|---|---|
| MV3 SW 休眠导致长连接断开 | 侧边栏维持轮询；后台只做一次性上报；不依赖常驻 WS |
| 自动上报把桌面库写脏 | 内容哈希去重、用户可关、只在「保存」时触发 |
| 双端同时改同一条 | rev + baseRev 冲突返回；默认桌面优先 |
| 插件体积/性能 | 只同步元数据，字幕按需拉取；大文件分页 |
| 两端继续漂移 | 共享流程只保留一份定义（M3 起以桌面为唯一来源） |

## 12. 当前状态（2026-10-30）

M1（连接层）、M2（库里数据双向）、M3（AI 能力委托）、M4（字幕/语音/导出的大部分）
已经落地；插件在桌面端不存在、未启动、未配置时全部有本地回退。

## 13. 验收矩阵

| 要求 | 实现 | 证据 |
|---|---|---|
| 1. 双向沟通、无感 | 自动发现、保存后自动上报、离线队列补传、`/v1/pull` 下行、状态点 | `desktop-link-test`、`bridge-e2e` |
| 2. 插件可独立使用 | 所有桌面调用失败都回退本地；不依赖桌面进程 | 全量插件测试（无桌面） |
| 3. 功能与桌面对齐 | 总结/对话/翻译/校对/导出/ASR/TTS 连接时走桌面实现 | `desktop-ai-test`、桥 E2E、桌面对应测试 |
| 4. 数据无感互通 | 字幕+总结自动入库；库镜像；总结/笔记/标签/合集回写；删除同步 | 桥 E2E、`panel-library-test` |
| 5. 桌面增强插件 | 桌面 AI、本地 Whisper、TTS、翻译、校对、导出引擎、设置单点 | 同上 |

### 有意保留的差异

- **轨道选择**：桌面端因为没有插件的「URL/签名/cid 身份链」而采用更严格的覆盖率
  （70%/50%）与关键词判定；插件已有四层身份校验，沿用更宽松阈值可避免误杀
  真实的长视频/部分字幕。这是有意差异，不是遗漏。
- **对话历史**：插件按视频保存在本地 IndexedDB，并整段同步到桌面 `chat.db`
  （桥接会话专用；桌面端编辑该会话后，下次插件同步会覆盖）。
- **增量同步**：按 `videos.updated_at` / `trash.created_at` 做 ms 游标增量；
  首次与游标过旧仍走全量快照，不是独立 `change_log` 表。
- **MCP**：桥接 AI 已恢复 MCP；危险工具通过 `approval` 事件逐次询问，120 秒未响应按拒绝。

### 回归命令

```bash
cd desktop && npm run check && npm run smoke
node scripts/mocks/bridge-e2e.mjs
cd ../verify && npm test
```

> 2026-10-30 实跑：桌面 178 文件 / 1056 通过 / 1 跳过；冒烟 19/19；桥 E2E 全过；
> 插件全部套件通过，panel-test 520 项 0 失败。
