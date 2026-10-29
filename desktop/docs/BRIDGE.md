# 插件 ↔ 桌面桥协议（v1 / v2）

桌面端在本机 `127.0.0.1` 上启动 HTTP 服务，浏览器插件把抓到的字幕 / 总结推过来。
只监听回环地址；除 `/v1/hello` 外都需要 Bearer Token。

- **v1**：`/v1/ingest` 单条推送，旧插件仍可用；
- **v2**：`/v1/events` 批量事件 + `/v1/pull` 下行长轮询，支持自动同步与桌面端主动通知。
  插件侧实现见 `shizi-extension/src/sidepanel/modules/desktop-link.js`。
- 对齐方案与后续同步/RPC 计划见 [docs/EXTENSION-DESKTOP-ALIGNMENT.md](../docs/EXTENSION-DESKTOP-ALIGNMENT.md)。

## 配对（默认零配置）

1. 桌面端打开 **设置 → 插件桥**，确认「启用本机接收」。
2. 扩展会自动探测 `127.0.0.1:47821~47830` 的 `GET /v1/hello`，拿到端口与 Token 后直接连接，**不需要用户填写**。
3. 桌面端设置页也提供「安装浏览器插件」：准备扩展目录、复制路径并打开浏览器扩展页。

手动配对仍然支持：桌面端设置里能看到端口和 Token；只有自动发现失败（例如改过端口/安全软件拦截）时才需要手动填。

Token 首次启动时自动生成，保存在 `%APPDATA%\shizi\settings.json`（旧版为 `bsub-desktop`）。
泄漏后可在设置里改端口 / 清空 Token 重启，会重新生成。

## 接口

### GET /v1/hello（无需鉴权，供扩展自动发现）

```http
GET /v1/hello
Origin: chrome-extension://<扩展 ID>
```

```json
{
  "ok": true,
  "app": "shizi",
  "name": "拾字",
  "protocol": 2,
  "minProtocol": 1,
  "version": "0.161.0",
  "instanceId": "uuid",
  "port": 47821,
  "token": "…",
  "capabilities": ["ingest", "events", "pull", "library.read", "library.changes", "chat.sync", "ai.chat", "ai.summarize", "asr.local", "tts", "export", "translate", "optimize", "settings.read"]
}
```

- 只接受扩展来源（`chrome-extension://` / `moz-extension://`）或没有 Origin 的本机进程；
  网页 `https://…` 来源返回 403，且不会返回 Token。
- 扩展拿到后会自动保存端口/Token，后续请求直接复用。
- `protocol` 缺失表示旧桌面端，新插件只走 v1；`instanceId` 变化表示桌面端重启，
  插件会重置下行游标。

### GET /v1/health

```http
GET /v1/health
Authorization: Bearer <token>
```

```json
{ "ok": true, "version": "0.1.0", "library": { "videos": 3, "segments": 2401 } }
```

### POST /v1/events（v2，批量上行）

```http
POST /v1/events
Authorization: Bearer <token>
Content-Type: application/json
```

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
        "video": { "bvid": "BV1…", "cid": 1, "title": "…", "owner": "…", "duration": 100, "url": "…", "signature": "…" },
        "track": { "lan": "ai-zh", "lanDoc": "中文（AI）", "source": "extension", "isAi": true },
        "lines": [{ "start": 0.1, "end": 1.2, "text": "…" }],
        "summary": "可选 Markdown",
        "model": "deepseek-chat"
      }
    }
  ]
}
```

- 单次最多 50 条，请求体上限 20MB；
- `id` 是幂等键：重复提交同一 id 返回 `duplicate: true`，不会重复入库；
- 逐条返回 `{ id, ok, ... }`，单条失败不影响同批其它事件；
- 当前支持：`history.upsert`（字幕 + 可选总结）、`video.captured`（仅字幕）、
  `summary.saved`（仅总结）；`note.saved` / `page.context` 在后续里程碑接入。

### GET /v1/pull（v2，下行长轮询）

```http
GET /v1/pull?since=41&wait=25000
Authorization: Bearer <token>
```

```json
{
  "ok": true,
  "protocol": 2,
  "instanceId": "uuid",
  "cursor": 42,
  "reset": false,
  "events": [
    { "seq": 42, "type": "library.changed", "payload": { "uids": [] } }
  ]
}
```

- `wait` 最长 25 秒；没有事件时超时返回空数组；
- 桌面端保留最近 500 条事件；`since` 太旧返回 `reset: true`，插件应做一次全量同步；
- `since=0` 表示「从现在开始」，用于首次连接；
- 当前事件：`library.changed`（字幕/总结入库后触发）；`settings.changed` 在后续里程碑接入。

### POST /v1/rpc（v2，能力调用）

```http
POST /v1/rpc
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "protocol": 2, "method": "ai.summarize", "stream": true, "params": { "video": {}, "lines": [], "web": true } }
```

支持的方法：

| method | 说明 |
|---|---|
| `ping` | 健康检查 |
| `settings.read` | 返回**脱敏** AI 状态：是否可用、当前模型、平台名；**不含 Key** |
| `ai.summarize` | 走桌面 `summarizeChat`（原总结提示词 + 工具循环），与桌面总结一致 |
| `ai.chat` | 走桌面 `chat()`；字幕/页面/联网由桌面按自己的设置处理 |
| `tts.speak` | 用桌面 TTS（Edge / SAPI / OpenAI）合成语音，返回 `dataUrl`；非流式 |
| `export.build` | 用桌面导出引擎生成 6 格式 × 4 模板内容，返回 `{content,ext,mime,filename}`；非流式 |
| `translate.lines` | 走桌面翻译链路（分批/术语表/并发），返回 `{lines,language}`；非流式 |
| `optimize.lines` | 走桌面校对口径（分批/术语表/联网核对），返回 `{suggestions}`；非流式 |

`ai.*` 默认返回 NDJSON（每行一个事件）：

```json
{"type":"delta","text":"## 标题"}
{"type":"reasoning","text":"…"}
{"type":"status","text":"联网检索：…"}
{"type":"tool","event":{"name":"app__web_search","phase":"end"}}
{"type":"done","text":"完整正文","model":"deepseek-chat","references":[]}
{"type":"error","error":"…"}
```

- 客户端断开连接会 abort 桌面端请求；
- `ai.chat` 当前禁用 MCP（桥接调用不在桌面 UI 里逐次审批危险工具），只保留只读 app 工具与联网工具；
- 插件侧 `desktop-ai.js` 在连不上/未配置 AI 时自动回退本地；总结在「桌面端还没输出任何字」时也会自动回退一次。

### GET /v1/library/changes?since=ms（v2，增量）

- `since=0` 返回 `{full:true}`，插件改走全量列表；
- 否则返回 `since` 之后变更的 `items` + 回收站里的 `deleted`（uid 墓碑）；
- 插件按 `serverTime` 更新游标。

### POST /v1/chat/sync（v2，对话同步）

```json
{ "key": "v|BV1xx|123|1", "videoKey": "…", "videoTitle": "…", "messages": [{ "role": "user", "content": "…" }] }
```

按 `key` 建一个专用桥接会话，**整段替换**消息（不碰桌面端自己的会话），重复同步幂等。

### GET /v1/chat/export?all=1（v2，对话导出）

- 不带 `all`：只导出插件写入的桥接会话，沿用插件 `key`；
- `all=1`：导出桥接会话 + 桌面原生会话；原生会话 key 为 `desktop:<id>`；
- 返回 `{ conversations: [{ key, videoKey, videoTitle, title, updatedAt, messages }] }`；
- 插件首次迁移会拉回本地，桌面原生会话只做只读预览。

### GET /v1/settings/shared?includeSecrets=1（v2，共享设置快照）

返回两端都有意义的设置：

- AI 平台 / Key / 模型 / 温度 / maxTokens；
- 检索平台 / Key / 结果数 / 联网策略；
- ASR 平台 / Key / 语言 / 并发 / 超时；
- 提示词模板 / 总结格式规则 / 术语表；
- 导出格式与模板。

默认 `includeSecrets=0`，只返回 `hasKey` 标记；`includeSecrets=1` 才返回明文 Key，仅供本机首次迁移使用，不写日志。

### POST /v1/settings/shared（v2，导入共享设置）

请求体为 `GET` 返回的 `settings` 对象。按平台 `id` 合并：

- 已存在的平台更新字段；不存在的追加；
- 空 `apiKey` 不覆盖已有 Key；
- 当前 activeId 只在对应平台存在时切换；
- 写完由桌面 `saveSettings` 重新加密 Key。

### POST /v1/rpc/approval（v2，MCP 审批）

```json
{ "id": "approval-id", "allow": true }
```

配合 `ai.chat` 流里的 NDJSON `{"type":"approval","id","name","detail"}`；
120 秒未决定按拒绝处理。

### POST /v1/asr（v2，本地 Whisper）

```http
POST /v1/asr?duration=30&format=wav&language=zh&title=…&url=…
Authorization: Bearer <token>
Content-Type: application/octet-stream
```

请求体是**原始音频字节**（WAV 16k 单声道或 M4A，上限 64MB）。桌面端把它写入临时文件，
交给当前 ASR 平台；只有「本地 Whisper」就绪（`settings.read` 的 `asr.ready`）才接受，
否则返回 409，让插件回退在线 ASR。

成功响应：

```json
{
  "ok": true,
  "text": "完整文本",
  "model": "ggml-base.bin",
  "segments": [{ "t": 0, "d": 2.4, "text": "第一句" }]
}
```

`t` / `d` 是相对于这一片音频的时间（秒）。

### GET /v1/library/items（v2，只读）

```http
GET /v1/library/items
Authorization: Bearer <token>
```

返回桌面库的列表投影，**不含字幕正文**（最多 500 条，按更新时间倒序）：

```json
{
  "ok": true,
  "items": [
    {
      "uid": "v:BV1xx:123",
      "bvid": "BV1xx",
      "cid": 123,
      "title": "…",
      "owner": "…",
      "cover": "…",
      "url": "https://www.bilibili.com/video/BV1xx",
      "kind": "video",
      "source": "bilibili",
      "duration": 100,
      "updatedAt": 1761740000000,
      "summaryUpdatedAt": 1761740000000,
      "summaryModel": "deepseek-chat",
      "summaryPreview": "…",
      "noteUpdatedAt": null,
      "tags": ["…"],
      "collections": ["…"],
      "trackCount": 1,
      "lineCount": 240,
      "chars": 12000
    }
  ],
  "total": 1,
  "serverTime": 1761740000000
}
```

插件把它写入 IndexedDB 的 `desktopLibrary`，离线时继续显示上次镜像。

### GET /v1/library/item?uid=…（v2，只读）

返回单条详情：`item` + `summary`（完整 Markdown）+ `note` + `tracks`（轨元数据），
仍不含字幕正文。找不到返回 404。

### POST /v1/library/summary（v2，回写）

```json
{ "uid": "v:BV1xx:123", "content": "## 总结…", "model": "plugin", "baseUpdatedAt": 1761740000000 }
```

- `baseUpdatedAt` 是插件上次读到的 `summaryUpdatedAt`；
- 桌面端当前值更新 → 返回 **409** `{ ok:false, conflict:true, summary }`，不覆盖；
- 成功返回 `{ ok:true, summary:{ content, model, updatedAt } }`。

### POST /v1/library/note（v2，回写）

```json
{ "uid": "v:BV1xx:123", "content": "笔记…", "baseUpdatedAt": 0 }
```

同样的乐观并发规则；`content` 为空表示删除笔记。

### POST /v1/library/tags / collections（v2，回写）

```json
{ "uid": "v:BV1xx:123", "tags": ["教程", "AI"] }
{ "uid": "v:BV1xx:123", "collections": ["合集 A"] }
```

整组替换（空数组 = 清空）；标签/合集名称不存在时桌面端自动创建。
返回保存后的名称数组。

### POST /v1/ingest（v1，兼容）

旧插件仍可用；行为等价于一条 `history.upsert`（带 summary 时会一并保存）。



```http
POST /v1/ingest
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "protocolVersion": 1,
  "clientId": "browser-profile-uuid",
  "browserKind": "chrome",
  "extensionVersion": "2.17.8",
  "video": {
    "bvid": "BV1xrnz6gEVD",
    "cid": 42926145926,
    "title": "折1万次，会坏吗？iPhone Duo深度评测",
    "owner": "影视飓风",
    "duration": 1492,
    "url": "https://www.bilibili.com/video/BV1xrnz6gEVD",
    "cover": "https://i0.hdslb.com/..."
  },
  "track": {
    "lan": "ai-zh",
    "lanDoc": "中文",
    "source": "extension",
    "isAi": true,
    "url": "https://aisubtitle.hdslb.com/..."
  },
  "lines": [
    { "start": 0.14, "end": 1.1, "text": "既然是折叠屏" },
    { "start": 1.1, "end": 1.42, "text": "有问题" }
  ],
  "summary": "可选的 Markdown 总结",
  "model": "deepseek-chat"
}
```

成功响应：

```json
{
  "ok": true,
  "videoId": 1,
  "trackId": 1,
  "lineCount": 751,
  "created": false,
  "summarySaved": true
}
```

错误响应：

| 状态 | 场景 |
|---|---|
| 401 | Token 缺失或不匹配 |
| 400 | 不是合法 JSON、缺少 `video`、`lines` 为空 |
| 403 | 非本机连接 |
| 500 | 入库异常（错误信息在 `error` 字段） |

## 去重规则

- 视频按 `bvid + cid`（番剧按 `epId + cid`）唯一；重复推送会更新元数据。
- 字幕轨按 `video_id + lan + source` 唯一；重复推送会替换该轨的旧分段。
- 可选 `summary` 按视频唯一，后一次覆盖前一次。
- 分段写入 `segments` 与 FTS5 索引，搜索立即可见。

## 浏览器插件接入建议

> 扩展侧已实现：`src/sidepanel/modules/desktop-link.js`（自动发现 / 离线队列 / 下行轮询）+
> `desktop-bridge.js`（兼容旧导出）+ 设置 → 桌面端。
> **默认无需点按钮**：保存字幕/总结后自动入队并上报；桌面端不在时留在 IndexedDB，重连补传。
> 字幕面板「⋯ → 立即同步到桌面」只用于手动补一次（跳过内容去重）。
> 桌面端设置 → 插件桥提供「安装浏览器插件」，会准备目录并打开扩展管理页。

1. `manifest.json` 需要：

```json
"host_permissions": ["http://127.0.0.1/*"]
```

2. 连接时先 `GET /v1/hello` 自动获取 `{ port, token, protocol, capabilities }`；
   失败时按 1s→30s 退避，不阻塞面板。
3. 保存后把当前视频写进 IndexedDB 队列（每个 uid 只留最新一份），再批量 POST：

```js
const info = await fetch('http://127.0.0.1:47821/v1/hello').then((r) => r.json());
const res = await fetch(`http://127.0.0.1:${info.port}/v1/events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${info.token}`
  },
  body: JSON.stringify({
    protocol: 2,
    client: { id: 'extension', browser: 'chrome', version: '2.19.0' },
    events: [{ id: crypto.randomUUID(), type: 'history.upsert', payload }]
  })
});
const result = await res.json();
if (!result.ok) throw new Error(result.error || '推送失败');
```

4. 成功后删除队列项；失败保留，重连后补传。不要因为推送失败清空本地历史。
5. 桌面端可用时维持 `GET /v1/pull` 长轮询；页面隐藏/关闭前停止，避免 MV3 生命周期问题。
6. Token 只保存在本机，不要写进日志或上传。

## 安装浏览器插件

桌面端 → 设置 → 插件桥 → **安装浏览器插件**：

- 自动定位扩展目录（打包版：`resources/extension`；开发版：仓库里的扩展源码）；
- 把目录路径写入剪贴板，并尝试打开已安装的 Edge / Chrome 扩展管理页；
- 按弹窗提示：开启「开发者模式」→「加载解压缩的扩展」→ 选择该目录。

扩展加载后会自动发现桌面端，无需再配对。

## 本机测试

```bash
node scripts/mocks/bridge-test.mjs
```

脚本会读取 `%APPDATA%\Electron\settings.json`（或 `BSUB_BRIDGE_SETTINGS` 指定的路径），
用其中的端口和 Token 调 `/v1/health`、`/v1/ingest`、`/v1/events` 与 `/v1/pull`，
并验证无 Token 时返回 401。
