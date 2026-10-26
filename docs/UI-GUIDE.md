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

### 7 个分组

| id | 名称 | 放什么 |
|---|---|---|
| `general` | 通用 | 通用、标签页与会话、快捷键 |
| `appearance` | 外观与浏览器 | 外观、地址栏与搜索、页面与阅读 |
| `ai` | AI 与语音 | AI 平台、按任务选模型、助手档案、ASR、TTS、语音输入、OCR、提示词、校对 |
| `search` | 检索与知识 | 联网检索、知识库、MCP、Skills、插件桥 |
| `subtitles` | 字幕与播放 | 字幕与翻译/行为、播放速度、成片样式、导出默认值 |
| `desktop` | 桌面助手 | 效率工具、快捷取词、桌面宠物 |
| `data` | 数据与关于 | 用量统计、数据与备份、版本更新、诊断、站点权限 |

**不要轻易加第 8 个分组。** 新功能优先放进现有分组；只有用户会独立寻找的功能才新开分组。

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

## 4. 样式约定

- 全部在 `renderer/src/styles.css`，按组件分块，不要新增 CSS-in-JS。
- 颜色/间距优先用变量：`--text`、`--muted`、`--faint`、`--border`、`--surface`、`--surface-2`、`--accent`、`--accent-soft`。
- 新增类名用 `组件-元素`：`.chat-menu-card-title`、`.settings-nav-desc`。
- 按钮优先级：
  - 主操作：`.mini-btn.primary` 或 `.chat-send`
  - 次操作：`.mini-btn`
  - 图标：`.icon-btn`
- 新手说明统一用 `.settings-hint`（灰色小字），不要写成段落正文。

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

截图确认后，把需要的图复制到 `docs/screenshots/`，并更新 README 引用。

## 6. 验证清单

- `npm run typecheck` / `npm run lint`（0 warning）
- `npm test`（当前 125 文件 / 732 用例）
- 改设置/对话：`npm run smoke`（19 条 E2E）
- 改插件：`cd verify && node bundle.js && node panel-test.js`
- 手动过一遍：设置 7 个分组、对话 `＋` 面板、页面/联网 chip、发送、历史会话。
