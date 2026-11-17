# 本地 Agent 接口（HTTP + MCP）

桌面端可以把自身能力开放给本机的 Agent（Claude Code、Codex、自研脚本等）。
默认**关闭**，在「设置 → 检索与扩展 → 本地 Agent」里开启。

- 只监听 `127.0.0.1`；
- 所有请求都要 `Authorization: Bearer <token>`；
- 默认只读；写操作每次弹确认，勾选「信任」后不再询问；
- 审计日志：`<userData>/agent-audit.log`。

---

## 1. 开关与凭据

| 项 | 说明 |
|---|---|
| 启用 | 生成/复用 Token，在配置的端口启动 HTTP 服务 |
| 端口 | 默认 47830；被占用时自动往后试 10 个 |
| Token | 24 字节随机值；「重置」后旧客户端立即失效 |
| 信任 | 打开后写操作不再逐次确认；随时可关 |

Token 只保存在本机 `settings.json`，不会上传。

---

## 2. HTTP

### 健康检查

```http
GET /v1/agent/health
Authorization: Bearer <token>
```

### 能力清单

```http
GET /v1/agent/info
Authorization: Bearer <token>
```

返回 `{ ok, protocol, version, trusted, tools: [{ name, description, scope, inputSchema }] }`。

### 调用

```http
POST /v1/agent/call
Authorization: Bearer <token>
Content-Type: application/json

{ "method": "tabs.list", "params": {} }
```

成功：`{ "ok": true, "data": ... }`
失败：`{ "ok": false, "error": "..." }`（写操作被拒绝也走这里）

---

## 3. MCP

无状态 Streamable HTTP 子集，直接 POST JSON-RPC：

```http
POST /mcp
Authorization: Bearer <token>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

支持 `initialize`、`ping`、`tools/list`、`tools/call`、`notifications/*`（返回 202）。

客户端配置：

```json
{
  "mcpServers": {
    "shizi": {
      "url": "http://127.0.0.1:47830/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

MCP 工具名使用下划线（`tabs_list`、`page_click`），HTTP 方法名使用点号（`tabs.list`、`page.click`）。

---

## 4. 工具

| 名称 | 权限 | 说明 |
|---|---|---|
| `app.info` | 只读 | 版本、平台、Electron/Chrome 版本 |
| `tabs.list` | 只读 | 标签页列表 |
| `tabs.open` | 写 | 打开标签页（http/https） |
| `tabs.activate` | 写 | 切到指定标签 |
| `tabs.close` | 写 | 关闭标签 |
| `tabs.navigate` | 写 | 当前标签跳转 |
| `page.info` | 只读 | 当前页面标题/URL/类型/UP/时长 |
| `page.text` | 只读 | 页面可读正文（默认 2 万字） |
| `page.click` | 写 | 点击 CSS 选择器命中的元素 |
| `page.type` | 写 | 写入文本，可选提交表单 |
| `page.scroll` | 写 | 上/下/顶/底滚动 |
| `page.wait` | 写 | 等待元素出现 |
| `library.list` | 只读 | 最近入库 |
| `library.search` | 只读 | 字幕库检索 |
| `library.detail` | 只读 | 视频信息 + 总结 + 笔记 |
| `settings.get` | 只读 | 设置（API Key / 桥 Token 已脱敏） |
| `plugins.list` | 只读 | 已安装应用插件 |
| `extensions.list` | 只读 | 已安装浏览器扩展 |

> 写操作（scope=write）在未信任状态下会弹出系统确认框：
> 「允许一次 / 拒绝」，并可勾选「信任这个 Agent，以后不再逐次询问」。

---

## 5. 安全边界

- 只接受 loopback 连接，外部机器访问不到；
- Token 比较使用常量时间比较；
- 所有能力是固定表，Agent 不能通过参数调用任意 IPC；
- 网页正文属于不可信输入：Agent 读到的页面内容不应被当作指令；写操作仍走确认；
- 审计日志只记录方法名、成败与错误，不记录页面正文与密钥。
