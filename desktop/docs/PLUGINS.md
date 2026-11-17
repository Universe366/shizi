# 插件（Plugin）与浏览器扩展（Extension）

桌面端同时支持两种“外部能力”，它们的定位完全不同，不要混用：

| | 应用插件 | 浏览器扩展 |
|---|---|---|
| 目录 | `userData/plugins/<id>/` | 用户自己的解压目录 |
| 清单 | `manifest.json`（本文件定义的格式） | Chrome/Edge 的 `manifest.json` |
| 界面 | 侧栏面板（`shizi-plugin://` iframe） | 页面内 content script / 扩展弹窗 |
| 能力 | 宿主 RPC，按 `permissions` 校验 | Chromium 扩展 API（Electron 支持的子集） |
| 入口 | 设置 → 检索与扩展 → 插件 | 设置 → 检索与扩展 → 浏览器扩展 |

浏览器扩展由 Chromium 直接加载（`session.loadExtension`），只在内置标签页生效；
侧栏网页使用独立 partition，不加载扩展。

安装格式：

| 格式 | 支持 | 说明 |
|---|---|---|
| 解压目录 | ✅ | 目录内直接有 `manifest.json` |
| `.zip` | ✅ | 商店下载的 zip；顶层套一层目录也能识别 |
| `.crx` | ✅ | 自动剥掉 CRX2/CRX3 签名头后按 zip 解压 |
| 商店一键安装 | ❌ | 不访问商店接口；请先下载包再安装 |

安装后会复制到 `<userData>/extensions/<随机目录>`，原文件可以删除。
ZIP 解析是内置的（STORE + DEFLATE），不额外依赖解压库；加密包 / ZIP64 会直接报错。

---

## 1. 应用插件的最小结构

```
my-plugin/
├─ manifest.json
└─ index.html        # 面板入口
```

`manifest.json`：

```json
{
  "id": "com.example.notes",
  "name": "示例笔记",
  "version": "1.0.0",
  "description": "把当前页面加进自己的待办",
  "author": "you",
  "permissions": ["storage", "page.read", "tabs.open"],
  "contributes": {
    "panels": [{ "id": "main", "title": "笔记", "icon": "📝" }],
    "commands": [{ "id": "open", "title": "打开示例笔记" }]
  }
}
```

字段约束：

| 字段 | 说明 |
|---|---|
| `id` | 小写字母/数字/点/下划线/短横线，2–64 位；决定安装目录 |
| `name` | 必填，≤80 字 |
| `version` | 缺省 `0.0.0` |
| `permissions` | 见下表；未申请的权限在 RPC 层直接拒绝 |
| `contributes.panels` | 最多 12 个；`entry` 默认 `index.html` |
| `contributes.commands` | 最多 40 个；会出现在命令面板（Ctrl+K） |

面板/命令的 `entry` 必须是插件目录内的相对路径：不允许绝对路径、盘符、`..`。
安装时会检查入口文件是否存在。

安装：设置 → 检索与扩展 → 插件，三种方式：

| 方式 | 说明 |
|---|---|
| 安装插件目录 | 直接选包含 `manifest.json` 的文件夹 |
| 从 zip 安装 | 解压到临时目录 → 校验入口 → 复制进 `userData/plugins/<id>` |
| 从链接安装 | 填一个 http(s) 的 zip 地址，下载后走同样的流程 |
| 从市场安装 | 配置市场索引地址，列表里一键安装/更新 |

目录安装会复制到 `userData/plugins/<id>`，源目录之后可以删除；
zip / 链接安装的临时目录在校验完成后清理。

示例：[`examples/plugin-hello`](../examples/plugin-hello)。

---

## 1.1 插件市场

市场就是一个 JSON 索引（放在任意 http(s) 地址，GitHub Pages / 对象存储 / 自建服务都行）：

```json
{
  "plugins": [
    {
      "id": "com.example.notes",
      "name": "示例笔记",
      "version": "1.0.0",
      "description": "把当前页面加进自己的待办",
      "author": "you",
      "zip": "https://example.com/plugins/notes-1.0.0.zip",
      "sha256": "64 位十六进制哈希（可选）",
      "minAppVersion": "0.163.0（可选）",
      "homepage": "https://github.com/you/shizi-notes",
      "tags": ["笔记", "bilibili"]
    }
  ]
}
```

- 也接受顶层直接是数组；
- `zip` 必须是 http(s)，并指向包含 `manifest.json` 的 zip；
- `sha256` 可选；提供时安装前会校验下载包，不匹配直接拒绝；
- `minAppVersion` 可选；高于当前版本时按钮显示「版本不兼容」；
- 索引里同一 `id` 只保留第一条，坏条目直接跳过；
- 设置页「插件」里填索引地址 → 保存 → 刷新市场；
- 已安装插件会显示已装版本，版本号不同则出现「更新」按钮（更新 = 重新下载 zip 覆盖安装）。

市场只做“索引 + 下载”，不做签名与审核；装之前请自己确认来源。

---

## 2. 插件界面与宿主通信

插件页面通过 `shizi-plugin://<pluginId>/<entry>` 加载到 iframe：

- 没有 Node、没有应用 DOM、不能直接发网络请求；
- CSP 由宿主注入：脚本/样式只能来自插件自己（允许内联），`connect-src 'none'`；
- 所有能力都走 `postMessage`：

```js
// 插件 → 宿主
parent.postMessage({ source: 'shizi-plugin', id: '1', method: 'page.info', params: {} }, '*');

// 宿主 → 插件
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.source !== 'shizi-host') return;
  if (data.ok) console.log(data.data);
  else console.error(data.error);
});
```

`id` 由插件自己生成并在响应里原样返回，宿主不做重排。

---

## 3. 能力（RPC）与权限

| 方法 | 需要权限 | 说明 |
|---|---|---|
| `app.info` | — | 版本、平台、Electron/Chrome 版本 |
| `theme.get` | — | 主题、强调色、配色、密度、字号 |
| `storage.get` | `storage` | 传 `key` 读单个值；不传返回整个对象 |
| `storage.set` | `storage` | `{ key, value }`，JSON 序列化；单插件上限 256KB |
| `storage.remove` | `storage` | `{ key }` |
| `library.query` | `library.read` | `{ query?, limit? }`；只返回标题/UP/封面/时长等摘要 |
| `page.info` | `page.read` | 当前标签页的标题、URL、kind、bvid/cid、UP、时长 |
| `net.fetch` | `net.fetch` | 只允许 http(s)，15 秒超时，响应上限 2MB |
| `tabs.open` | `tabs.open` | 在新标签页打开 http(s) 地址 |

权限在**主进程**校验：插件侧传什么参数都不能绕过。

---

## 4. 调试

1. 把插件目录复制到 `%APPDATA%\shizi\plugins\<id>`（或从设置页安装）；
2. 改完入口文件后，右键面板 → 重新加载（或重启应用）；
3. 面板 iframe 的 console 在 DevTools 的 frame 上下文里；`Ctrl+Shift+I` 打开主窗口 DevTools，
   在 Console 顶部的上下文选择器里选 `shizi-plugin://…`；
4. 加载失败时设置页会显示具体原因。

---

## 5. 安全边界（重要）

- 插件是**用户主动安装的第三方代码**，默认能力最小化：没有 Node、没有文件系统、没有任意网络；
- 插件 UI 与主界面不同源，只能通过 postMessage 交互；
- 插件不能自己声明“我要执行命令”这类权限——RPC 方法表在宿主侧固定；
- 浏览器扩展则是 Chromium 自己的权限模型（安装时由 Chromium 决定），
  与插件不是一套东西；Electron 不实现 `nativeMessaging`，依赖它的扩展无法工作。
