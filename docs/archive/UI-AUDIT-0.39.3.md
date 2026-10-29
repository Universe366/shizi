# 桌面端 UI 一致性与可维护性审计

> 历史审计：针对桌面 0.39.3，不代表当前 0.160.0 的界面；当前截图以最新 `artifacts/ui/` 与 `docs/screenshots/` 为准。
> 审计对象：`repo/desktop/src/renderer`（桌面 0.39.3，HEAD `0cc3843`）
> 方法：读代码 + 统计样式表（12,186 行 `styles.css`、156 个 TSX 组件）+ 计算 WCAG 对比度。
> 说明：本次**没有**看截图（模型无图像输入），结论全部来自代码与量化指标；截图复核见 §7。

---

## 0. 一句话结论

- **结构层一致，视觉层不一致。** 面板骨架（`panel / panel-toolbar / panel-title / toolbar-actions`）和按钮（`mini-btn` 占 7 成以上）有明确约定；但字号、圆角、间距、颜色、弹窗、空态这些"看得见的东西"是自由生长的。
- **维护难点不在 React，而在 `styles.css` 这一个 1.2 万行文件。** 它同时承担 token、组件、面板、桌宠、截图覆盖窗、起始页四代视觉；同一选择器被反复重定义，改一处要读三个地方。
- **"不够现代明亮"是可量化的，不是审美分歧。** 正文普遍 10–11px、提示文字对比度 2.8:1（AA 要求 4.5）、暖米底色 + 几乎看不见的描边、单一灰蓝强调色、22px 高的小按钮——这是"紧凑工具"的语言，不是 Cherry Studio 那种"留白 + 白底卡片"的语言。

---

## 1. 量出来的不一致

### 1.1 排版：21 种字号，九成文字 ≤ 11.5px

| 指标 | 数值 |
|---|---|
| `font-size` 取值 | **21 种**：8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 16 / 17 / 18 / 20 / 30 / 44 / 46 |
| ≤ 11.5px 的规则 | **333 条**（其中 < 11px 有 202 条） |
| ≥ 13px 的规则 | **40 条**（含 5 条 30–46px 的装饰字） |
| 出现最多的 | 10px（83）、11px（77）、10.5px（68）、12px（63）、11.5px（58） |

按面板统计平均字号，可以清楚看到**两套排版世界**：

| 面板 | 平均字号 | 规则数 |
|---|---:|---:|
| 记录 | 9.9px | 10 |
| 任务中心 | 10.0px | 39 |
| 对话 | 10.5px | 214 |
| 设置 | 10.6px | 108 |
| 字幕面板 | 11.3px | 56 |
| 起始页 v2 | 13.3px | 134 |
| 工作台 | 13.6px | 73 |

0.38 之前的老界面是 10.5px 密度，0.39 的新界面（起始页 / 工作台）是 13.5px 留白。两者同屏出现时，新页面显得"大一号"，旧页面显得"缩水"。

### 1.2 间距与圆角：没有刻度

| 指标 | 数值 |
|---|---|
| `padding` 字面量 | **146 种**写法 |
| `gap` 取值 | 14 种（6/8/4/2/10/7/3/5/1/12/9/14/18/22 px） |
| `border-radius` 取值 | **16 种**：2/3/4/5/6/7/8/9/10/11/12/14/16/22/999px |
| 直接写死的 `px` | **2,974 处** |

同一个"卡片"角色：`.settings-section` 是 10px 圆角 + `color-mix` 半透明底（styles.css:3718），`.start-widget-card` 是 16px 圆角 + 18px 模糊 + 大投影（styles.css:9896），`.workbench-card` 又是另一套。三个都叫卡片，视觉不是一家人。

### 1.3 颜色：98 个写死的色值，没有语义 token

| 指标 | 数值 |
|---|---|
| `styles.css` 里的十六进制色 | **171 处 / 98 个不同值**（token 块只占 28 处） |
| `rgba()` | 133 处 |
| 语义变量 | 只有 `--ok`、`--warn`、`--warn-soft`、`--warn-border`；**没有 `--danger`** |
| "错误红"实际用了 | **7 种**：#d9534f、#b4513f、#c2483d、#e5484d、#b71c1c、#e5544b、#c0392b（TSX 里还有 #c0392b） |
| "成功绿" | 3 种：#2e7d32、#3d8b5f、#35b57a |
| "警告橙" | 4 种：#d97706、#c77700、#d9a21b、#b8860b |

于是"删除"按钮在不同面板里是三种红，"已保存"是两种绿。改一次品牌色要全局搜 7 个值。

### 1.4 层级、动效、弹窗：各写各的

| 指标 | 数值 | 问题 |
|---|---|---|
| `z-index` | 17 个值（0…200，含 35/55/70/95/120） | 没有层级表，靠"比上一个大一点" |
| 动画时长 | 8 种（0.1 / 0.12 / 0.14 / 0.15 / 0.16 / 0.18 / 0.2 / 0.22s） | 同一交互在不同面板快慢不一 |
| `@keyframes` | 17 个（11 个是桌宠） | 桌宠动画占了动效预算的大头 |
| 弹窗/遮罩实现 | **10 套**：`confirm-backdrop`、`start-modal`、`wizard-overlay`、`palette-backdrop`、`gs-backdrop`、`radial-backdrop`、`reader-overlay`、`compare-overlay`、`drop-overlay`、`download-dialog` | 每套自带遮罩色、动画、居中方式 |
| 空态实现 | **10 套**：`panel-empty`、`stage-empty`、`summary-empty`、`workbench-empty`、`renders-empty`、`pet-empty`、`palette-empty`、`tab-empty`、`start-widget-empty` | 图标大小、文案灰度、留白都不同 |
| `window.confirm` 原生弹窗 | **14 处**（`LibraryPanel.tsx:524/537`、`SettingsPanel.tsx:942/975/998/1024/1039`、`SettingsPage.tsx:20/93`、`BrowserHub.tsx:117/128`、`DataBackupSection.tsx:81`、`UsageSection.tsx:162`、`SubtitlesPanel.tsx:1093`） | 应用自己做了 `ConfirmDialog`，却只有 2 个组件用；删除/清空/未保存提醒走的是系统对话框，**样式和语言都不统一** |

### 1.5 样式表是"追加式"长出来的

| 指标 | 数值 |
|---|---|
| `styles.css` | **12,186 行 / 1,687 条规则 / 1,559 个不同选择器** |
| 被定义 **2 次以上** 的选择器 | **75 个** |
| 最严重 | `.settings-nav-item` 4 次；`.settings-page`、`.settings-page-head`、`.settings-page-content`、`.settings-toc`、`.app-shell.vertical-tabs .tab-strip`、`.start-hero-v2`、`.start-widget-grid` 各 3 次 |
| `!important` | 14 处 |
| Tailwind | `styles.css:1` 引入、`package.json:37/55` 装了 `tailwindcss`+`@tailwindcss/vite`，但全项目 **0 个工具类**在用（只有 preflight reset 生效） |

文件里有两段标题直说这是补丁：`/* ---------- 设置页视觉优化 ---------- */`（8452 行）与 `/* ---------- 设置页打磨 ---------- */`（10501 行）。**同一个页面被追加重构了三轮，旧规则没删。** 结果是"设置页"的最终样子要靠 3 段级联叠加才能推出来——这正是维护困难的来源：想改一个导航项颜色，得先确认哪一段最后生效。

### 1.6 深色模式只是"换底色"

全文件只有 **1 个** `@media (prefers-color-scheme: dark)` 块（styles.css:25），重定义 15 个基础色。所有写死的 `#fff`、7 种红、3 种绿都不跟着变。可直接验证的 bug：

```css
/* styles.css:734 */
.primary-btn { background: var(--accent); color: #fff; }   /* 深色 --accent = #8fb0cc */
```

深色模式下白字压在浅蓝底上，**对比度 2.27:1**（AA 需要 4.5）。同角色的 `.mini-btn.primary` 用的是 `color: var(--surface)`（1188 行），深色下自动变成深字——**同一个按钮两种写法，一个对一个错**。

---

## 2. 对比度：为什么"不亮"

| 组合 | 当前比值 | 结论 |
|---|---:|---|
| `--text` #1d1d1b 于 `--bg` #f5f5f2 | 15.5 | 正文够黑 |
| `--muted` #71716a 于白色 | 4.92 | 刚过 AA |
| `--muted` 于 `--bg` | 4.50 | 压线 |
| **`--faint` #9a9a92 于白色** | **2.83** | **不达 AA**（`--faint` 被用了 163 次） |
| **`--faint` 于 `--bg`** | **2.59** | 不达 AA |
| `--border` #e2e2dc 于白色 | 1.30 | 描边"若有若无" |
| 白字于深色 `--accent` | 2.27 | 不达 AA |

"发灰、发闷"的根因是三条叠加：

1. **底色是暖米色 #f5f5f2**，不是中性白。它和白色卡片的明度差只有 1.09:1，卡片浮不起来，整个界面像一张纸。
2. **正文 10.5px + 提示色 2.8:1**。同样一段说明文字，Cherry Studio 用 13–14px 正灰，我们用 10.5px 浅灰——信息量一样，观感差一档。
3. **只有一个灰蓝强调色 #4f6f8f**，没有彩色 chip、没有强调底、没有状态色的统一用法。Cherry 的"亮"很大程度来自**大面积白 + 少量高饱和色块**的对比。

---

## 3. 哪些地方其实是一致的（别改坏）

- 面板骨架统一：`SubtitlesPanel / SummaryPanel / ChatPanel / LibraryDetailHeader / LibraryListHeader / SettingsPanel` 都用 `panel + panel-toolbar + panel-title + toolbar-actions`。
- 按钮有主次：`mini-btn` 240 次、`mini-btn primary` 52 次、`icon-btn` 24 次——一条约定覆盖了绝大多数场景。
- 设置页有真正的组合层：`SettingsSection`（折叠 + localStorage + 描述表）+ `registry.tsx`（7 分组）+ `descriptions.ts`，文档 `docs/UI-GUIDE.md` 也写清楚了。这是全项目最健康的一块 UI 架构。
- 任务域拆分、IPC 分域、测试覆盖（775 用例）与 UI 无关，不受本次审计影响。

**问题不在"没有规范"，而在"规范只覆盖了 0.38 的界面，0.39 的新界面各自另起炉灶"**：KnowledgePanel 自造 `knowledge-head/knowledge-title`、TaskCenter 自造 `task-head`、StartPage/Workbench/Pet 完全独立。文件里也留了痕迹——`docs/UI-GUIDE.md:146` 明写"全部在 styles.css，按组件分块，不要 CSS-in-JS；颜色/间距优先用变量"，但实际有 171 处写死颜色、146 种 padding。

---

## 4. 维护难度评估：结论是"会"

| 场景 | 现在的代价 |
|---|---|
| 改一个通用观感（比如"卡片再亮一点"） | 要改 token + 3 套卡片类 + 2 段设置页覆盖段，且无法确认没有第 4 处 |
| 新增一个面板 | 没有可复用的 `Panel`/`Card`/`EmptyState`/`Dialog` 组件，只能抄最近的相似面板——继续分叉 |
| 深色模式修 bug | 只能靠人眼扫 171 处写死色值；无 lint 规则拦截 |
| 重构设置页 | `.settings-page` 前缀下 63 条规则分散在 3 段，删除任一段都可能影响其他页面（`.settings-hint` 等类被全站复用） |
| 新人接手 | 12k 行 CSS 无分区文件、无组件目录、无视觉回归；CI 只跑 typecheck/lint/unit/build（`.github/workflows/desktop-ci.yml`），**CSS 改动零保护** |
| 一次 UI 改动的回归面 | 只能手动跑 `npm run smoke` + 肉眼看 `tools/ui-shots.mjs` 的 3 张图 |

对比 Cherry Studio：它的界面建立在 Ant Design 的 token 体系上（`colorPrimary`、`borderRadius`、字号/间距算法派生），组件复用 AntD 的 Button/Modal/Empty/Table。**它的"现代"是体系产物，不是手调产物**；我们这边是手调产物——所以越加功能越不一致，维护成本随功能数线性上升。

---

## 5. 改造方案（按投入产出排序）

### P0 正确性（半天，先止血）

1. `.primary-btn`、`.pet-root .mini-btn.primary` 改 `color: var(--surface)`，与 `.mini-btn.primary` 统一；深色下对比度回到 8:1 以上。
2. 补 `--danger` / `--danger-soft` / `--success` / `--warning` 四个语义 token，把 7 种红、3 种绿、4 种橙收敛到各 1 个（`color-mix` 派生 hover/soft）。
3. 14 处 `window.confirm` 换成已有的 `ConfirmDialog`（或抽 `useConfirm()`），删除类操作统一走应用内弹窗。

### P1 Token 层（1–2 天，观感提升最大）

新增 `renderer/src/styles/tokens.css`，把"颜色/间距/字号/圆角/阴影/动效/层级"一次定义清楚；`styles.css` 只保留 `@import`。

建议值（已核算对比度）：

```css
:root {
  /* 中性色：中性灰白，去掉米色偏黄 */
  --bg: #f6f7f9;        /* 由 #f5f5f2 改为中性 */
  --surface: #ffffff;
  --surface-2: #f1f3f5;
  --border: #e4e7ec;
  --border-strong: #d3d8e0;
  --text: #16181c;      /* 17.8:1 */
  --muted: #5b6270;     /* 6.1:1 */
  --faint: #6b7280;     /* 4.8:1 —— 现在是 2.8，这一条最影响"亮" */

  /* 语义色 */
  --accent: #3b6fd4;         /* 白字 4.76:1，可用于实心按钮 */
  --accent-soft: #eaf0fc;
  --danger: #d64545;  --danger-soft: #fdecec;
  --success: #2f855a; --success-soft: #e9f6ef;
  --warning: #b7791f; --warning-soft: #fdf3e2;

  /* 字号刻度：6 档，最小 11px */
  --fs-xs: 11px; --fs-sm: 12px; --fs-base: 13px;
  --fs-md: 14px; --fs-lg: 16px; --fs-xl: 20px;

  /* 间距：4 的倍数 */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px;

  /* 圆角 / 阴影 / 动效 / 层级 */
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --shadow-1: 0 1px 2px rgba(16,18,22,.06);
  --shadow-2: 0 4px 16px rgba(16,18,22,.08);
  --shadow-3: 0 12px 32px rgba(16,18,22,.12);
  --dur-fast: 120ms; --dur-base: 160ms; --dur-slow: 240ms;
  --z-dropdown: 30; --z-sticky: 40; --z-overlay: 60; --z-modal: 70; --z-toast: 80;
}
```

同表给出深色：`--bg #111214 / --surface #17181b / --text #eceef1 / --muted #a3a9b4 / --faint #7c828d(4.6:1) / --accent #7aa2f7(深字 7.4:1)`。

**关键：只换这 6 个中性色 + 字号下限，全站立刻"亮"一档**，因为 1,286 处 `var()` 会跟着走；剩下 171 处硬编码再逐个收敛。

### P2 基础组件（3–5 天）

| 组件 | 替代 |
|---|---|
| `ui/Button`（variant: primary/secondary/ghost/danger，size: sm/md） | 6 种按钮类 + 一次性 class |
| `ui/Field`（label/hint/error 三行结构） | `settings-label/hint/inline` 散用 |
| `ui/Card` | `.settings-section`/`.start-widget-card`/`.workbench-card` 三套 |
| `ui/Dialog`（含遮罩、焦点陷阱、Esc、动画） | 10 套弹窗实现 |
| `ui/EmptyState`（icon/title/desc/action） | 10 套空态 |
| `ui/Badge`、`ui/Menu`、`ui/Segmented` | 各处一次性实现 |

### P3 样式表拆分（与 P2 同步）

```
src/styles/
  tokens.css        # 唯一变量来源
  base.css          # reset、滚动条、选区、字体
  layout.css        # app-shell / sidebar / tab-strip / address-bar
  ui/               # button.css field.css card.css dialog.css menu.css empty.css
  panels/           # subtitles.css summary.css chat.css library.css settings.css
  features/         # start.css workbench.css library-page.css
  pet.css  capture.css  wizard.css
styles.css          # 只留 @import，顺序即层级
```

同时删掉 `/* 设置页视觉优化 */` 与 `/* 设置页打磨 */` 两段（把最终值并回 `panels/settings.css`），75 个重复选择器降到个位数。

### P4 防回退（1 天）

1. **stylelint**：禁止在 `ui/`、`panels/` 之外写十六进制色；禁止 `font-size` 用非 token 值；禁止新增 `z-index` 字面量。
2. **CI 加一条 `npm run audit:ui`**：把本次统计脚本固化（不同色值数、字号种数、重复选择器数），超过阈值就失败。
3. **视觉回归**：把 `tools/ui-shots.mjs` 扩成 6 个稳定状态（起始页/设置/字幕/对话/库/工作台），本地 `npm run shots:diff` 出像素差；Windows runner 上接进 `desktop-ci.yml`（非阻塞起步）。
4. 删 Tailwind（0 使用）或真正引入按 `@theme` 用——**不要留着"看着像在用"**。

### 不建议

- 全量重写成 Tailwind / CSS-in-JS：12k 行 + 156 个组件，收益低、风险高，且与 `docs/UI-GUIDE.md` 的约定冲突。
- 先做"视觉翻新"再整理 token：会制造第四段"打磨"。

---

## 6. 验收标准（改造后应达到）

| 指标 | 现在 | 目标 |
|---|---:|---:|
| 字号种数 | 21 | ≤ 7 |
| 小于 11px 的规则 | 202（8/8.5/9/9.5/10/10.5px） | 0 |
| 非 token 十六进制色 | 171 处 / 98 值 | 0 |
| 重复定义的选择器 | 75 | ≤ 10 |
| 弹窗实现 | 10 套 | 1 套 |
| 空态实现 | 10 套 | 1 套 |
| `window.confirm` | 14 | 0 |
| `--faint` 对比度 | 2.83 | ≥ 4.5 |
| 深色模式实心按钮对比度 | 2.27 | ≥ 4.5 |

---

## 7. 我这次没做、但建议补的

1. **人工看图**：`node tools/ui-shots.mjs` 重新出图（当前 `artifacts/ui/*.png` 的像素统计异常：>50% 像素是 #9d–#9e 的中灰，像被模糊/遮罩过，不能作为对比依据）。
2. **与 Cherry Studio 的逐屏对照**：需要 Cherry 的实际截图与 token（本次外网抓取失败，未引用其具体色值；§2 的对比只基于通用设计原则与本仓库实测数据）。
3. **无障碍抽查**：`mini-btn` 高 22px，低于 WCAG 2.2 的 24px 最小点击目标；改 token 时顺带把 sm 尺寸提到 24–26px。

---

*审计脚本（可复现）：统计逻辑见本次会话；关键命令：`grep -oE 'font-size: *[0-9.]+(px|rem)' styles.css | sort | uniq -c`、`grep -c '!important' styles.css`。*

---

## 8. 进展（同一次会话内已落地）

> 下面是审计后立即实施的部分，2026-10-27。验证：`npm run check`（136 文件 / 781 用例）、`npm run smoke`（E2E 19/19）、`tools/start-page-check.mjs`、`tools/theme-check.mjs`。

| 审计项 | 处理 |
|---|---|
| 深色主按钮 2.27:1 | 新增 `--accent-ink`，按强调色亮度自动选白/深字；slate 深色 **8.46:1** |
| 7 红 / 3 绿 / 4 橙 | 收敛到 `--danger` / `--ok` / `--warn`（含 soft 底色），组件里不再写死 |
| 暖米底色、`--faint` 2.83 | 新 `styles/tokens.css`：中性灰白、`--faint` **4.83:1**；起始页实测平均亮度 158 → 240 |
| 14 处 `window.confirm` | 换成 `askConfirm()` + `ConfirmHost`（应用内弹窗），只留无宿主时的兜底 |
| 起始页 1350 行单文件 | 拆成 `components/start/` 六个模块 + `styles/start.css`；v3 单列布局、搜索直达、右键菜单、拖拽、壁纸抽屉、极简模式 |
| 废弃 `.start-*` 规则 | `styles.css` 删除 184 条（12,186 → 10,7xx 行） |
| `.mini-btn` 22px | 24px / 字号 11px（点击目标与可读性） |

第二轮（同一天，随 0.39.4 发布）：

| 审计项 | 处理 |
|---|---|
| 9 套空态 | 新增 `components/ui/EmptyState.tsx`（图标 + 标题 + 说明 + 操作）；浏览器空页 / 总结 / 对话 / 起始页空分组迁移；其余空态类共用同一套 CSS 配方，删除 11 条旧规则 |
| 10 套弹窗外观 | 确认框 / 起始页弹窗 / 多模型对比 / 阅读器 / 下载弹窗共用 `--radius-xl` + `--shadow-lg` + 同描边（交互类型仍分开：抽屉、命令面板、轮盘） |
| 22 种字号 | 收敛到 11 / 12 / 13 / 14 / 16 / 20 六档（400 条规则改用 `--fs-*`），仅保留 30/36/46px 展示型大字号 |
| Tailwind 只当 reset | 移除 `tailwindcss` / `@tailwindcss/vite` 依赖与插件，补基础 reset |

现状：`styles.css` 10,7xx 行、`styles/start.css` 1,4xx 行、`styles/tokens.css` 96 行；字号 6 档 + 3 个展示值；构建与测试全绿。