# 界面维护指南（桌面端）

> 适用：桌面端 0.39+。这里写「界面怎么组织、改哪里、怎么验证」，不重复功能说明。
> 相关：[架构](ARCHITECTURE.md)、[数据模型](DATA-MODEL.md)、[README](../README.md)。

## 1. 两套界面，两套规则

| 界面 | 入口 | 改之前注意 |
|---|---|---|
| 桌面端 | `desktop/src/renderer/` | React 19 + 纯 CSS；只能通过 `window.bsub` 访问主进程 |
| 浏览器插件 | `shizi-extension/src/sidepanel/` | 原生 JS + 自己的样式；不要和桌面端共享 DOM |

本指南只讲桌面端。

## 2. 设置页信息架构（0.39.1 起）

设置页由「左导航 → 分组 → 折叠分区」三层组成：

```
SettingsPage.tsx            左导航、页头、目录（TOC）
└─ components/SettingsPanel.tsx   表单状态、保存、搜索过滤
   └─ components/settings/*
      └─ SettingsSection.tsx      每个折叠分区
```

### 8 个分组

| id | 名称 | 放什么 |
|---|---|---|
| `general` | 通用 | 网络代理、视频下载、标签页与会话、快捷键 |
| `appearance` | 外观与浏览器 | 外观、地址栏与搜索、页面与阅读 |
| `ai` | AI 与模型 | AI 平台、按任务选模型、对话上下文/快捷指令、助手档案、总结提示词 |
| `voice` | 语音与识别 | ASR、本地模型、文字朗读、语音输入、OCR |
| `subtitles` | 字幕与播放 | 字幕行为/翻译/倍速/成片样式、字幕校对、导出默认值 |
| `search` | 检索与扩展 | 联网检索、插件桥、MCP、Skills |
| `desktop` | 桌面助手 | 效率工具、快捷取词、桌面宠物、快捷轮盘 |
| `data` | 数据与关于 | 用量统计、数据与备份、版本更新、诊断、站点权限 |

每个分组尽量不超过 6 个 section；超过时优先拆成语义更明确的独立分组，而不是继续往下堆。

本地 Whisper 的模型/组件下载、选用、删除只在「本地 Whisper 模型」里出现；语音识别平台页不再重复一套路径输入。用量统计的「最近请求」是固定高度滚动区（表头吸顶）。

### 三个必须同步的地方

1. **分组注册表**：`components/settings/registry.tsx`
   - `label`、`description`（页头副标题与导航第二行）、`tips`（分组顶部上手提示）。
2. **渲染映射**：`components/SettingsPanel.tsx`
   - 用 `{show('分组 id') && <XxxSection … />}` 控制哪个分区出现在哪个分组。
   - 旧的 `sessions/address/reading/efficiency/usage/plugins` id 已在 0.39.1 合并，不要再使用。
3. **分区说明**：`components/settings/descriptions.ts`
   - key 必须与 `SettingsSection` 的 `title` 完全一致；也可以在调用处传 `description` 覆盖。
   - 描述会显示在折叠标题下，**不要写超过两行**。

### 新增一个设置分区

```tsx
// components/settings/MySection.tsx
import { SettingsSection } from './SettingsSection';

export function MySection({ value, onChange }: Props) {
  return (
    <SettingsSection title="我的功能" defaultOpen={false}>
      <div className="settings-hint">一句话说明这个开关会影响什么。</div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用我的功能
      </label>
    </SettingsSection>
  );
}
```

然后：

1. 在 `SettingsPanel.tsx` 里找到合适的分组，加 `{show('ai') && <MySection … />}`。
2. 在 `descriptions.ts` 加 `我的功能: '……'`。
3. 如果它属于新的设置字段：`shared/types.ts` → `settings.ts` 默认值与归一化 → `SettingsPanel` 的 draft 传递。
4. 跑 `npm run check`，再 `npm run smoke`。

### 搜索与目录的工作方式

- 搜索：`SettingsPanel` 给每个 `.settings-section` 设置 `style.display`，同时统计可见分区数量；`SettingsPage` 用 `MutationObserver` 同步目录。
- 目录：只读 `.settings-section-name`，**不要**改回 `.settings-section-title`，否则会把说明文字拼进目录。
- 折叠状态存在 `localStorage`：`bsub.settings.section.<title>`。改标题会让用户丢失展开状态，属于可接受但要知道的行为。

## 3. 对话输入区（ChatPanel）

```
ChatPanel
├─ 消息列表（Markdown、工具卡片、审批卡片、分支/编辑/朗读）
├─ chat-menu                ＋ 打开的「更多工具」面板
│  ├─ chat-menu-grid        4 张卡片：MCP / 多模型对比 / 图片 / 新对话
│  └─ chat-menu-row         助手档案、页面上下文、联网、技能
└─ chat-composer
   ├─ textarea
   └─ chat-composer-bar
      ├─ chat-bar-left      ＋、页面 chip、联网 chip、当前档案 chip
      └─ chat-bar-right     token 估算、麦克风、发送
```

原则：

1. **输入框附近最多 5 个可见控件**，其余进 `＋` 面板。
2. 每个菜单卡片必须有 `title` 和一句 `desc`，不要只放图标。
3. 开关状态用 `is-on` chip 表达，不要再用「开/关」文字按钮。
4. 新增长文本选项时放 `chat-menu-row`，不要塞进 `chat-bar-left`。

### 加一个工具菜单项

```tsx
<button className="chat-menu-card" onClick={...}>
  <SomeIcon size={15} />
  <span className="chat-menu-card-title">名称</span>
  <span className="chat-menu-card-desc">一句话说明</span>
</button>
```

### 状态与持久化

| 状态 | 存在哪 |
|---|---|
| 页面上下文 / 联网 | `localStorage`：`chat-page`、`chat-web` |
| 助手档案 | `localStorage`：`chat-profile`，并写回 `chat.db` 的 `profile_id` |
| MCP 工具选择 | `localStorage`：`chat-tools`（`null` = 全部，`[]` = 不用） |
| 多模型选择 | `localStorage`：`chat-compare` |

**注意**：选了助手档案时，请求不再下发 `mcpToolIds`，避免手动勾选覆盖档案配置。

### AI 平台与模型能力

- 能力推断：`shared/modelCapabilities.ts`（文本始终可用，图片/音频按模型名与平台类型推断）。
- 用户覆盖：`settings.ai.capabilities[capabilityKey(platformId, model)] = { vision, audio }`。
- 设置 UI：`AiSection.tsx` 的「模型能力」三个 chip；文本只读，图片/音频可勾选。
- 平台总览：卡片列出所有平台（当前编辑/使用中/Key 状态），点卡片切换编辑；「本地模型」一键加入 Ollama / LM Studio / llama.cpp。
- 模型管理：「添加自定义模型名」把模型写进 `platform.models` 并设为当前模型；「获取模型列表」从平台接口拉取。
- 默认模型：`TaskModelSection` 的「默认模型」以当前平台为默认，可按任务覆盖平台/模型；留空即跟随当前平台。
- 对话拦截：`ChatPanel` 根据当前档案/平台/模型计算 `visionEnabled`；关闭时不给选图片、发送前报错。主进程 `chat.ts` 也会二次校验，避免绕过 UI。
- 新增能力（如视频输入）：先扩 `ModelCapability` 与推断规则，再接 UI/请求；不要只在 renderer 判断。

### 文本附件 / 引用 / 快捷指令

- 附件：`＋ → 文本附件`，支持 txt/md/srt/vtt/json/csv 等，最多 3 个、每个 1MB、截断 30k 字符；存 `messages.attachments_json`。
- 发给模型时 `expandForModel()` 把附件文本拼进 content；界面只显示 `.chat-attachment-chip`，不把整段文本铺进气泡。
- 引用：消息操作里的 Quote 图标，下一次发送会在 content 前加 `> 引用：…` 块；发送后清空。
- 快捷指令：`＋` 面板底部「总结 / 待办 / 时间线 / 提问清单」，直接调用 `send(prompt)`。
- 新增附件类型：改 `addTextFiles()` 的扩展名/大小限制与 API 的 `ChatAttachment` 类型；不要只在前端限制。

## 4. 样式约定

- 变量在 `renderer/src/styles/tokens.css`（唯一来源），组件样式在 `renderer/src/styles.css` 按组件分块，起始页单独在 `renderer/src/styles/start.css`。不要新增 CSS-in-JS。
- **组件里不要写十六进制色值**，一律用语义变量：

  | 用途 | 变量 |
  |---|---|
  | 底色 / 卡片 / 次级底 | `--bg`、`--surface`、`--surface-2`、`--surface-3` |
  | 文字三级 | `--text`、`--muted`、`--faint`（保证 ≥ 4.5:1，不要自己配灰色） |
  | 描边 | `--border`、`--border-strong` |
  | 品牌 | `--accent`、`--accent-soft`、`--accent-ink`（强调色上的文字，运行时按对比度自动选白/深） |
  | 语义 | `--ok`、`--warn`、`--danger` 及各自的 `-soft` |

- 字号/圆角/阴影/动效只在 token 里取：`--fs-xs…--fs-xl`、`--radius-sm…--radius-xl`、`--shadow-sm…--shadow-lg`、`--dur-fast/base`。
- 新增类名用 `组件-元素`：`.chat-menu-card-title`、`.settings-nav-desc`。
- 按钮优先级：
  - 主操作：`.mini-btn.primary` 或 `.chat-send`
  - 次操作：`.mini-btn`（高度 24px）
  - 图标：`.icon-btn`
- 新手说明统一用 `.settings-hint`（灰色小字），不要写成段落正文。
- 二次确认一律用 `askConfirm()`（`components/ui/confirm.tsx`，App 里挂了 `ConfirmHost`），不要再写 `window.confirm`；弹窗文案用 `{ title, description, confirmText }`。

## 5. 截图与视觉检查

```bash
cd desktop
unset ELECTRON_RUN_AS_NODE
npm run build
cd ..
node tools/ui-shots.mjs        # artifacts/ui/{start-page,settings-page,vertical-tabs}.png
```

`ui-shots.mjs` 会检查：

- 设置页 sticky 搜索栏是否被遮挡（`stickyTop` / `overflow`）；
- 目录是否可见、点击后是否跳到正确分区（`toc check`）；
- 垂直标签栏操作菜单是否完整。

起始页与主题另有两个专门的探针：

```bash
node tools/start-page-check.mjs   # 起始页布局尺寸 / 溢出 / 搜索直达 / 右键菜单 / 抽屉 / 极简
node tools/theme-check.mjs        # 明暗两套主题下主按钮与说明文字的对比度
```

截图确认后，把需要的图复制到 `docs/screenshots/`，并更新 README 引用。

## 6. 起始页

编排：`renderer/src/components/StartPage.tsx`；子模块在 `components/start/`：

```
StartPage.tsx          状态、IPC、设置读写（唯一持有 shortcut/widget 状态的地方）
start/SearchBar.tsx    引擎切换 + 站内直达 + 历史 + 搜索建议
start/ShortcutBoard.tsx 分组标签、站点卡片、拖拽、右键菜单、添加入口
start/ShortcutDialog.tsx 新增/编辑弹窗
start/WidgetPanel.tsx  天气 / 待办 / 番茄钟 / 便签 / 热搜 / 最近入库 / 最近访问 + 编辑态开关
start/PomodoroWidget.tsx 25 分钟专注 / 5 分钟休息，结束自动换阶段
start/NotesWidget.tsx  便签，输入自动写 localStorage
start/CommandPalette.tsx 指令面板（⌘/Ctrl+K）：操作 / 页面 / 小组件 / 搜索 / 快捷方式
start/Dock.tsx         底部 Dock：常用站点 + 内置页面 + 指令面板 / 禅模式
start/SiteIcon.tsx     站点 favicon，失败回退字母色块
start/WallpaperDrawer.tsx 壁纸、模糊/遮罩、极简模式
start/model.ts         类型、壁纸清单、农历、favicon 与配色工具
start/useStartClock.ts 时钟状态与刷新频率（15s / 1s）
start/useStartWeather.ts 天气状态、城市与强制刷新
start/useStartWallpaper.ts 壁纸/图库/墨色/轮播状态与副作用
start/commands.ts      指令面板的静态命令与动态搜索命令
start/bookmarks.ts     Chrome / Edge 书签 HTML 解析
start/pomodoroStore.ts 全局番茄钟（跨页面/重启）
styles/start.css       起始页全部样式（只作用于 .start-page 子树）
```

### 配色

- 预设：`shared/colorSchemes.ts`（9 套，浅色/深色各有 accent + soft）。
- 设置：`general.colorScheme`；`custom` 时使用 `general.accentColor`。
- 应用：`lib/appearance.ts` 的 `applyAppearance()` 监听系统深浅色变化，切换 `--accent` / `--accent-soft`，并按强调色亮度自动设置 `--accent-ink`（深色主题下浅色强调色会自动配深字）。
- 新增配色：只改 `COLOR_SCHEMES`，不要在每个组件里写死颜色。
- 站点图标优先站点自己的 `/favicon.ico`，失败回退到域名生成的字母色块（`tileColor()`），不经过第三方图标服务。

### 材质

- 起始页统一液态玻璃：页底有蓝/紫/粉三团缓慢漂移的光斑，卡片/搜索/侧栏/抽屉使用 34px 模糊 + 半透明渐变 + 白色高光边；Dock 在布局流底部，不覆盖小组件。`data-ui-glass="off"` 时退回无模糊。
- 玻璃不透明度：抽屉「背景效果 → 玻璃」10–100%（默认 58%），作用于网址卡片、小组件、搜索、Dock、侧栏；抽屉/菜单/指令面板固定 92% 以保证可读性。
- 卡片 hover 上浮 3px，圆角 18–20px，阴影分两层（环境阴影 + 内高光）。

### 资料库直达

- 资料库列表点击条目直接打开原网页；字幕 / 总结 / 笔记通过行尾「查看字幕 / 总结 / 笔记」进入。
- 在线视频下载完成后会自动加入资料库，保留原网页、标题、UP 与封面；下载并发 8。

### 成片与处理

- 左侧导航：任务 / 字幕 / 样式 / 合成 / 批量 / 记录，参考 VideoCaptioner 的分步工作台。
- 任务：选本地视频、直接拖入文件或粘贴链接；拖入 .srt/.vtt 直接进字幕编辑，下载完成后自动回填到任务。可切换识别引擎（设置里的 ASR 平台）。
- 字幕：原文/译文双列可编辑；每行支持合并下一行、拆成两行、删除；支持 AI 优化建议、质检（点击问题跳行）、断句、翻译、存入资料库。
- 样式：字体、字号、颜色、描边、位置、双语，右侧实时预览，可保存默认或预设。
- 合成：可直接选视频、导入字幕；硬字幕/软字幕、配音、导出与成片记录。
- 批量：上半部分是本地文件队列（拖入多个文件、顺序转录、入库、用当前样式批量出片），下半部分可从资料库多选批量出片。

### 文件转换（Filee 风格）

- 左侧拖放区与文件队列，右侧视频/音频/图片格式环；下方显示最近 12 条转换记录。
- 拖动文件经过拖放区时会在光标处出现格式环，直接把文件松在某个格式上即可开始转换。
- 格式环点击也会立即转换已入队文件；中心显示当前目标格式。

### 布局

```
start-topbar     品牌 + 指令面板 / 禅模式 / 编辑 / 壁纸
start-hero       时钟 / 农历 / 问候 / 搜索 / 常去站点
start-board      分组标签 + 常用标签 + 标签筛选 + 密度切换 + 导入/导出 + 内置入口 + 站点卡片网格
start-widget-area 天气（体感/湿度/风/4 日预报）/ 待办 / 番茄钟 / 便签 / 热搜 / 最近入库 / 最近访问（可开关、可排序）
start-dock       底部 Dock（sticky）：常用站点、内置页面、指令面板、禅模式
start-footnote   操作提示、导入导出设置
```

### 交互约定

- 搜索：输入即匹配收藏站点（第一条建议直接打开），名称完全一致时回车直达；输入 ≥2 字后 250ms 防抖请求 Bing 联想词（主进程缓存 10 分钟，失败静默回退本地建议）。`/` 聚焦搜索框，`Esc` 先清空再关闭；页面空白处直接打字也会聚焦搜索框并带入第一个字符（输入法组合态除外）。抽屉可关闭联网联想词。
- 指令面板：`Ctrl/⌘ + K` 打开，子序列模糊匹配，`↑`/`↓` 选择、`Enter` 执行、`Esc` 关闭、`Tab` 在面板内循环；命令由 StartPage 组装（搜索 / 最近使用 / 操作 / 页面 / 小组件 / 快捷方式）。执行过的命令记入 `localStorage: start-palette-recent`，关闭后焦点回到打开前的位置。输入网址或 BV 号时第一条是「打开 …」。
- 卡片：左键打开，右键菜单「打开 / 详情 / 固定到 Dock / 复制链接 / 编辑 / 删除」；无需进入编辑模式即可拖动排序/换组（向后拖插到目标之后），拖到分组标签可直接归组，拖到「新分组」标签输入名称即可从现有卡片创建分组；编辑模式用于批量选择与分组管理。
- 标签：编辑弹窗可填描述与标签（≤6，逗号/空格分隔）；标签行按标签筛选，可与分组、常用叠加。
- 分组：标题前的箭头可折叠/展开；编辑态可重命名（分组标题旁 ✎），删除分组会把站点移到「常用」。
- 布局：桌面宽屏的主内容限制 1120px 居中；分组栏默认收起，只留 12px 边缘，鼠标移到所在侧或聚焦时滑出，移开自动收回。分组栏可在「背景效果 → 分组栏位置」切换左侧 / 右侧；顶栏的固定按钮可以让它保持展开。从上到下是全部 / 常用 / 分组 / 新分组，底部「工具」区是密度、导出、导入、书签、批量、添加。窄屏自动变为顶部横向条。
- 分组：支持创建空分组并持久化；拖动卡片到分组标签即可归组，拖到「新分组」会弹出命名框；分组标签本身可拖动排序，顺序写入 `start-group-order`。
- 密度：导航底部「舒适 / 紧凑 / 大图标」，紧凑模式隐藏域名、只留图标与名称。
- 常用：按打开次数排序的虚拟标签（最多 8 个），次数存在本地。
- 数据：标签栏「导出 / 导入」按钮，JSON 含快捷方式、外观偏好、壁纸直链、壁纸收藏/轮播、便签、使用次数与番茄轮数；底部「同步到文件夹 / 从文件夹恢复」会把同样内容写到设置里的同步文件夹（`shizi-start.json`），由 OneDrive/坚果云等客户端负责上传。抽屉可开「自动同步到文件夹」（2 秒防抖）。导入走 `parseStartBackup()` 校验并 askConfirm 合并。本地 GIF/视频在 IndexedDB，不随备份导出；导入时遇到 file 壁纸会跳过并提示。
- 书签导入：工具栏书签按钮选择 Chrome/Edge 导出的 `bookmarks.html`，`parseBookmarksHtml()` 按文件夹映射分组、URL 去重，确认后合并。
- 撤销：删除快捷方式、删除待办、清除已完成、清空便签都会弹 6 秒 toast，点「撤销」恢复上一步。
- 待办与小组件：待办超过 4 条可展开/收起，条目可拖动排序；逾期待办显示红色时间；编辑态的小组件开关可拖动调整顺序（也保留 ↑↓）。
- 批量操作：编辑态点击卡片多选，顶部出现「已选 N」，可批量移动到分组或删除（删除可撤销）。
- 渐进渲染：单个分组默认只渲染前 60 个，底部「显示更多」每次追加 60 个，避免几百个快捷方式一次挂载。
- 浏览器级虚拟化：分组使用 `content-visibility: auto` + `contain-intrinsic-size`，离屏分组跳过布局与绘制。
- 小组件折叠：每个组件标题右侧的箭头可折叠/展开，状态存 `localStorage: start-widget-collapsed`。
- Dock：右键 Dock 项或卡片都可打开同一套菜单（打开 / 详情 / 固定 / 复制 / 文件夹 / 编辑 / Dock 左移·右移 / 删除），菜单自动夹在窗口内；固定项按 `general.startDockIds` 顺序展示并可拖动排序；没有固定项时回退到「常用」或前 6 个；删除快捷方式会同步清掉固定 id。
- Dock 编辑：点右侧铅笔进入，图标抖动并显示移除按钮，完成后退出；编辑态「＋」可从候选站点添加，网格图标可直接拖进 Dock；至少保留一个图标。
- 快捷方式文件夹：右键「新建文件夹…」或选中多个后点「文件夹」，文件夹卡片可点击展开，支持拖入图标、移出单个图标；备份会保留 folder 字段。
- Dock 自动隐藏：抽屉「背景效果 → Dock」可切换常驻 / 自动隐藏；自动隐藏时只留 8px 边缘，鼠标移入滑出。
- 指令面板的「搜索字幕库 / 总结」直接打开全局搜索（App 的 GlobalSearch）。
- 菜单键盘：搜索引擎菜单、卡片右键菜单都支持 `↑`/`↓` 与 `Esc`；`?` 随时重新打开快捷操作提示。
- 自动获取：编辑弹窗「自动获取」调用 `start:probe-site` 填标题/描述；批量导入时名称仍是域名的条目会自动补全（最多 8 个、3 并发），失败保留原值。
- 批量导入：标签栏「批量」粘贴多行「名称 URL / 纯网址」，解析规则在 `start/model.ts` 的 `parseShortcutLines()`。
- 壁纸：右侧抽屉，含 6 套壁纸、本地上传图片 / GIF / 静音视频、远程直链、模糊与遮罩滑杆；自定义图片会压成 JPEG，GIF/视频原样存 IndexedDB。抽屉会预览当前自定义壁纸，并列出最近 8 天必应每日一图（选中后写 `startBingImage`，可恢复每日一图；加载失败可重试）。图库支持必应 / 渐变（本地 SVG，离线可用）/ Picsum / Wallhaven 四个源，可收藏并按 5 / 15 / 30 / 60 分钟轮播；在线源不可用时显示重试。URL 壁纸 404 或视频播放失败会自动回退到每日一图。壁纸在独立 `.start-wallpaper-layer` 图层里淡入，不再直接写页面背景。
- 时钟与天气：抽屉可切换「显示秒 / 12 小时制」；天气卡片右上角可在 °C / °F 间切换；抽屉可清空搜索历史。
- 番茄钟：标题显示「完成 N 轮 · 今日 M 分」，今日分钟按本地日期累计。
- 墨色自适应：对自定义壁纸与必应每日图采样平均亮度，给 `.start-page` 加 `is-ink-light` / `is-ink-dark`；抽屉可手动选「自动 / 浅色字 / 深色字」（`localStorage: start-ink-mode`）。远程图/视频无 CORS 时保持主题默认。
- 动态降级：`prefers-reduced-motion` 下动画/过渡近似关闭，壁纸视频不自动播放。
- 禅模式（极简模式）：隐藏小组件、站点分组、常去站点、Dock 与底部提示，顶栏只留禅模式按钮，显示「按 Esc 退出禅模式」与轻微的呼吸动画；`Esc` 直接退出。
- 首次提示：第一次进入起始页显示快捷操作卡（Ctrl/⌘+K、E、右键），点「开始使用」后写入 `localStorage: start-onboarding-done`。
- 番茄钟：专注 25 / 短休 5 / 长休 15，开始/暂停/重置；状态在模块级 store（`start/pomodoroStore.ts`），离开起始页或重启应用后按 `endAt` 续跑，Dock 徽标同步显示剩余分钟。每完成 4 个专注自动进长休。
- 小组件：天气 / 待办 / 番茄 / 便签 / 热搜 / 最近 / 每日一句，全部支持拖动卡片直接排序；天气卡在三列布局中跨两列。
- 天气：体感 / 湿度 / 风 / 空气质量（US AQI、PM2.5、等级）/ 未来 12 小时逐小时温度与降水概率 / 4 日预报；右上角刷新按钮强制绕过 30 分钟缓存，并显示「更新 HH:MM」；失败时卡片内可重试；「使用当前位置」按出口 IP 定位城市（pconline）。
- 便签：直接写在卡片里，由 StartPage 统一持有，停止输入约 350ms 后写入 `localStorage: start-notes`，并随起始页备份导出。

### 状态与持久化

| 状态 | 存在哪 |
|---|---|
| 搜索引擎 | `general.searchEngine`（共享 `shared/searchEngines.ts`） |
| 快捷方式 | `general.startShortcuts` |
| 组件顺序/可见性 | `general.startWidgets`：**数组同时表示「显示」与「顺序」**，不在数组里即隐藏 |
| 天气/热搜开关 | `general.startWeather`、`general.startHotSearch`（兼容旧配置） |
| 壁纸 | `general.startWallpaper` / `startWallpaperImage` |
| 壁纸文件 | `IndexedDB: shizi-start-wallpaper/files/current`（GIF / 视频） |
| 壁纸直链 | `general.startWallpaperMedia = { kind, source: 'url', url }` |
| 搜索历史 | `localStorage: start-search-history`（最多 8 条） |
| 极简模式 | `localStorage: start-minimal`（`1`/`0`） |
| 壁纸模糊/遮罩 | `localStorage: start-wallpaper-effect`（`{ blur, dim }`） |
| 卡片密度 | `localStorage: start-density`（comfortable/compact/large） |
| 折叠的分组 | `localStorage: start-collapsed-groups`（数组） |
| 打开次数 | `localStorage: start-usage`（`{ [id]: count }`） |
| 便签 | `localStorage: start-notes`（纯文本，随备份导出） |
| 番茄钟 | `localStorage: start-pomodoro`（phase / rounds / running / left / endAt） |
| 文字配色 | `localStorage: start-ink-mode`（auto / light / dark） |
| 最近指令 | `localStorage: start-palette-recent`（最多 6 条） |
| 首次提示 | `localStorage: start-onboarding-done`（`1` 表示已关闭） |
| 必应图库选择 | `general.startBingImage` / `startBingCopyright` |
| Dock 固定 | `general.startDockIds`（最多 8 个，按顺序） |
| 时钟格式 | `localStorage: start-clock`（`{ seconds, hour12 }`） |
| 温度单位 | `localStorage: start-weather-unit`（`c` / `f`） |
| 联网联想 | `localStorage: start-search-suggest`（`0` 关闭） |
| 壁纸收藏 | `localStorage: start-bing-favorites`（URL 数组，最多 30） |
| 壁纸轮播 | `localStorage: start-bing-rotate`（0 / 5 / 15 / 30 / 60 分钟） |
| 组件折叠 | `localStorage: start-widget-collapsed`（id 数组） |
| 番茄统计 | `localStorage: start-pomodoro-stats`（`{ date, minutes }`） |

**加组件**：

1. 在 `WIDGET_LABELS` 与 `ALL_WIDGETS` 加 id（番茄钟 / 便签是现成参考）；
2. 在 `settings.ts` 的 `startWidgets` 默认值与白名单 `widgetIds` 里加 id；
3. 渲染一个 `.start-widget`，条件用 `widgetVisible(id)`；
4. 需要后端数据时加 IPC，并处理失败空态。

**注意**：组件顺序用 `orderOf(id)` 设置 CSS `order`；隐藏的组件不渲染，不要只靠 CSS 隐藏。

## 7. 地址栏与浏览器

- 地址栏：`components/AddressBar.tsx`。
- 历史/书签/下载/标签页：`components/BrowserHub.tsx`。
- 标签栏：`components/TabStrip.tsx`。
- 垂直标签栏：折叠后是 52px 图标轨道，悬停 140ms 展开；展开时 `App.tsx` 用 `--tab-peek-width` 给主区域让位，避免盖住地址栏。折叠态保留新建按钮；多选后可整组拖拽，固定标签不能拖入普通区/分组。
- 标签操作：右键支持复制标签页、重新加载、关闭左侧/右侧、复制链接/标题；头部操作菜单支持关闭重复标签。垂直标签栏的关闭按钮常驻显示，右键/分组菜单限制在标签栏宽度内，不会伸进网页区域。
- 网页右键菜单：原生系统菜单，页面保持可见；包含 AI 划词动作、后退/前进/刷新、复制/粘贴/全选、新标签打开链接、复制链接/图片地址、开发模式检查元素。
- 顶部工具栏：设置 → 外观与浏览器 → 浏览器工具栏，可逐项显示/隐藏后退、前进、刷新、搜索引擎、倍速、收藏、工作台、起始页、设置、主菜单。
- 后退/前进只跳到 http(s) 历史条目，跳过起始页/空白页，避免白屏。
- 设置 → 通用 → 默认浏览器：注册 http/https 协议，Windows 会打开默认应用设置让用户选择拾字。
- URL 展示：`shared/url.ts` 的 `compactUrl()`（去协议、`www.`、末尾斜杠；保留 query，去掉 hash）。
- 复制 URL：`canonicalUrl()` 保留协议/路径/有效参数，去掉常见跟踪参数；地址栏聚焦和右键复制都走它。
- 搜索引擎：`shared/searchEngines.ts`，地址栏、起始页、设置页共用；新增引擎只改这一处。
- 地址栏菜单优先用 `window.bsub.popupMenu()` 的系统菜单（网页视图会盖住 HTML 菜单）；没有该 API 时才回退 HTML 菜单。
- 地址栏聚焦时展示完整 URL，失焦回到紧凑形式；不要在聚焦时也压缩，否则编辑会误删协议。

改浏览器功能后至少跑：`AddressBar.test.tsx`、`BrowserHub.test.tsx`、`TabStrip.test.tsx` 和 `npm run smoke`。

## 8. 托盘与桌宠

### 托盘

- 创建：`main/shell.ts` 的 `createTray(options)`；入口在 `main/index.ts`。
- 菜单：显示/隐藏主窗口、起始页、工作台、设置、检查更新、退出。
- 点击托盘图标显示窗口；双击同样显示；tooltip 带版本号。
- 起始页/工作台/设置通过 `mainWindow.webContents.send('tray:action', action)` 通知渲染层，`App.tsx` 监听后切换 overlay。
- 新增托盘项：在 `TrayOptions` 加回调 → `index.ts` 传入 → `shell.tray.test.ts` 补断言。
- 托盘是**原生层**，不要直接操作 React state；一律发 `tray:action`。

### 桌宠气泡

- 尺寸：点击 ⤢ 打开 `.pet-size-panel`，可拖宽高滑杆（280–980 × 180–960）、选预设、调字号（80%–150%）。
- 持久化：尺寸走 `general.petBubbleWidth/Height` + `resizeBubble(w,h,true)`；字号走 `localStorage: pet-font-scale`。
- 拖拽：右边缘、下/上边缘、右下角（`.pet-resize*`）仍可用；主进程 `resizeBubble()` 负责最终 clamp，改上下限要同时改 renderer 滑杆与 main clamp。
- 不要再把 ⤢ 改成「循环预设」，用户需要的是自由尺寸。

## 9. 成片与处理流水线

文件：`components/StudioPanel.tsx` + `components/LocalWorkbench.tsx`。

- **不要**再拆成左侧步骤导航或左右分栏；它是一条连续流水线：
  `选择素材 → 生成字幕 → 整理字幕 → 出成片 → 成片记录`。
- 每一步是一个 `.pipeline-step`，步骤之间用 `.pipeline-connector` 连接；步骤头部有编号、标题、状态。
- 步骤内可以有空态，但下一个步骤始终可见；跳转用 `scrollToStep(id)`，不要切走页面。
- 成片记录 `RendersPanel` 放在流水线底部，不再占用右侧栏。
- 新增步骤：在 JSX 里加 section + connector，并保持 `id` 稳定（`step-source` 等），滚动定位依赖它。

### 成片样式（`SynthesizeDialog`）

- 样式模型在 `shared/ass.ts`（`SubtitleStyle`）：字体、字号、主色、描边色/宽度、阴影、距底部、对齐、双语。
- 对话框左侧改样式，右侧 16:9 预览按 1080p 等比缩放（`PREVIEW_SCALE`）；预览只是近似，真正渲染以 ASS 为准。
- 硬字幕 → MP4 烧录；软字幕 → MKV 内嵌 **ASS**（样式与双语都保留，播放器可开关）。
- 预设存在 `general.subtitlePresets`（最多 12 个），提交时会记住当前样式到 `general.subtitleStyle`。
- 合成进度通过 `synthesize:progress` 事件回到工作台（`.workbench-progress`），任务中心仍保留一份。

## 10. 联网检索与外部资料

- 入口：对话输入区的联网 chip / 助手档案的 web 开关 / 总结前的联网检索 / 核对。核心在 `main/web/`。
- `retrieve.ts`：所有入口共用的检索门面，统一查询清洗/去重/排序/正文读取/预算；差异只在策略（对话与总结 3 条查询、8 条结果、读 2 篇；核对 2 条查询、6 条结果、读 1 篇）。
- 设置页按能力分三类：**搜索服务商 / URL 获取服务商 / 优先使用模型内置 Web 工具**；自动联网、核对、结果数、缓存、黑名单在下方或折叠项。
- URL 获取服务商决定 `web_fetch`：内置抓取（免 Key）、Jina Reader（免 Key）、Tavily Extract、Exa Contents、Firecrawl；接口地址可覆盖。
- 模型内置 Web 工具：Gemini `google_search`、Claude `web_search`；开启后跳过外部检索，其他模型自动回退到搜索服务商。
- 联网工具：`app__web_search` 找链接，`app__web_fetch` 读具体页面正文（最多 3 次、内网地址拒绝）。
- `plan.ts`：规则式检索计划，最多 4 条（基础 / 时效 / 对照 / 一手），不额外调用模型；设置项 `search.planQueries`。
- `service.ts`：并发执行 → 合并 → 去重（URL + 内容指纹）→ 每域名最多 2 条 → 相关度/来源类型/时效排序 → 抓前 2 篇正文 → 分配 cite id。
- 结果元数据：`site / date / authority / rerank / summary / content / sourceType`；对话资料块要求用 `[n]` 标注来源。
- `[n]` 渲染：`Markdown` 接收 `citations` 后把 `[n]` 渲染为 `.cite-ref` chip，点击滚动到来源并高亮（`SourcesCard` / 对话来源列表的 `id=cite-*`）。
- 原则：外部资料只做补充与提示差异，不改写视频/字幕事实；总结里的「外部资料」与正文分开呈现。
- provider 协议在 `main/web/providers/`（13 个模块 + `shared.ts` + `index.ts` 注册表）；新增一家只需加模块并在注册表登记。
- 抓取正文按 URL 缓存 6 小时；设置「高级设置 → 检索诊断」可看次数/平均耗时/去重率/失败率/缓存大小，并可清空统计与缓存。

## 11. 字幕总结的 UI

- 当前总结走 `main/summaryChat.ts`：原总结提示词 + `chat()` 的 `app__web_search` / `app__web_fetch` 工具循环，不再分段。
- 状态文案来自 `onStatus`：获取热门评论、联网检索、读取网页、生成总结。
- 总结面板只保留一个「联网」开关；关闭后仍走对话式总结，但不给工具。
- 字数与耗时合并为一行；思考过程只折叠、不提供“隐藏”；外部资料列表可滚动。
- 完整流程、提示词与工具说明见 [`../desktop/docs/SUMMARY-FLOW.md`](../desktop/docs/SUMMARY-FLOW.md)。

## 12. 下载

### 下载（`DownloadVideoDialog`）

- 两条入口：粘贴链接（先「解析」再下载）与资料库多选；解析走 `video:download-probe`（yt-dlp `-J --flat-playlist`）。
- 列表（分P / 合集 / 番剧）会展开成可勾选条目，提交时只带 `playlistItems`，由主进程一次调用 yt-dlp 下载。
- 进度通过 `download:progress` 回传（百分比 / 速度 / ETA），队列在弹窗内串行执行，关闭后仍保留；失败可重试，可全部取消。
- 命名模板与「列表建子文件夹」在设置 → 视频下载；下载完成会写入导出记录（`kind: online-download`），弹窗底部「最近下载」可再打开。

## 13. 验证清单

- `npm run typecheck` / `npm run lint`（0 warning）
- `npm test`（当前 173 文件 / 1038 用例）
- 改设置/对话：`npm run smoke`（19 条 E2E）
- 改插件：`cd verify && node bundle.js && node panel-test.js`
- 手动过一遍：设置 8 个分组、对话 `＋` 面板、页面/联网 chip、起始页搜索建议、地址栏紧凑 URL、成片工作台六页、成片样式预览。