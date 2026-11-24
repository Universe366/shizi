# UI 统一与现代化（0.167.0）

> 审计结论：`styles/tokens.css` 已经有完整的设计变量，但组件层大量绕开它——
> 213 处硬编码颜色、30+ 种圆角、4 套遮罩、3 种阴影口径，看起来就「不一个系统」。

## 1. 审计数据

| 指标 | 现状 |
|---|---|
| 设计变量 | `tokens.css` 有颜色/字号/间距/圆角/阴影/层级 |
| 硬编码颜色 | `styles.css` 里 213 处（含 `#fff`、`rgba(0,0,0,.18)`） |
| 圆角 | 30+ 种（5/7/9/10/11/14/15/18/22…） |
| 遮罩 | confirm（blur 1.5px + color-mix）、palette（纯色 28%）、gs/sidebar（blur 2px）、radial（blur 3px） |
| 阴影 | 8/10/18/20/24px 混用，只有部分引用 `--shadow-md` |
| 焦点态 | 只有地址栏/设置输入框有 ring，其它按钮靠浏览器默认 |
| 动效 | 只有个别组件写了 transition，时长 0.15s/0.2s 不一 |

## 2. 规则（本次定稿）

1. **颜色只用语义变量**：`--surface/--surface-2/--surface-3/--border/--text/--muted/--faint/--accent/--danger`；
2. **圆角三档**：控件 8px（按钮/输入/行）、卡片 12px、浮层 16px；胶囊用 `--radius-pill`；
3. **遮罩一套**：`--overlay` + `--overlay-blur`，所有 backdrop 共用；
4. **阴影两档**：浮层 `--shadow-pop`、模态 `--shadow-lg`；
5. **焦点可见**：全局 `:focus-visible` 用 accent ring；
6. **动效统一**：`--dur-fast` + `--ease-out`，只过渡颜色/背景/边框；
7. 新组件不允许出现十六进制色值。

## 3. 本次迁移范围

- tokens.css：补 `--radius-xs/control/card/overlay/pill`、`--overlay/--overlay-blur`、`--shadow-pop`、`--ease-out`、`--surface-hover`；
- 全局：focus-visible、按钮过渡、选区颜色；
- 浏览器相关：地址栏与建议、顶部按钮、书签栏、浏览器中心、命令面板、确认弹窗、收藏/清除数据弹窗；
- 设置页外壳：section 圆角与背景；
- 空态/滚动条：沿用已有配方，仅统一颜色变量。

## 4. 验收

- [x] 上述区域不再出现裸十六进制色值（CDP 扫描：迁移范围内 0 处）；
- [x] 遮罩/阴影/圆角各只有一套来源（CDP 计算样式：palette 16px / blur(4px) / 统一遮罩色）；
- [x] 浅色/深色 token 正常切换（实测 `--overlay` 浅色 rgba(10,12,16,.36)、深色 rgba(0,0,0,.56)）；
- [x] `npm run check` / `npm run smoke` 通过。

## 5. 实现记录（0.167.0）

- tokens：新增 `--radius-xs/control/card/overlay/pill`、`--shadow-pop`、`--overlay`、`--overlay-blur`、`--surface-hover`、`--ease-out`；
- 全局：`:focus-visible` ring、按钮/输入过渡、`::selection`；
- 浏览器区域：地址栏/建议/顶部按钮/书签栏/浏览器中心/命令面板/确认与数据弹窗，全部改用语义变量；
- 命令面板新增 `.palette-item.is-ai` 样式（accent 色 + 选中浅底）；
- 设置页外壳圆角收到卡片档；危险按钮改为 `color: var(--surface)` + `filter` 悬停，去掉 `#fff/#9c4434`；
- 校验：CDP 计算样式（浅色 + 模拟深色）+ 全量测试/冒烟。
