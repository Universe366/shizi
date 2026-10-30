# 文档索引

> 适用版本：桌面 0.162.18 / 插件 2.20.11。先读根目录 [AGENTS.md](../AGENTS.md) 与 [HANDOFF.md](../HANDOFF.md)。

## 当前文档

| 文档 | 用途 |
|---|---|
| [REPO-MAP.md](REPO-MAP.md) | 目录地图、文档选择、维护规则 |
| [UI-GUIDE.md](UI-GUIDE.md) | 起始页 / 设置 / 对话 / 成片 / 浏览器的界面结构与改动入口 |
| [DATA-MODEL.md](DATA-MODEL.md) | SQLite 表、迁移、备份与恢复 |
| [QUALITY.md](QUALITY.md) | 当前测试基线、技术债与拆分顺序 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 桌面/插件/桥/字幕/AI/ASR/更新/发布的故障排查 |
| [MAINTAINERS.md](MAINTAINERS.md) | 发布、签名、版本与 Release 检查 |
| [SIGNING.md](SIGNING.md) | Windows 签名与安装包说明 |
| [../desktop/docs/ARCHITECTURE.md](../desktop/docs/ARCHITECTURE.md) | 桌面端模块边界与数据流 |
| [../desktop/docs/SUMMARY-FLOW.md](../desktop/docs/SUMMARY-FLOW.md) | 字幕总结全流程 |
| [../desktop/docs/BRIDGE.md](../desktop/docs/BRIDGE.md) | 插件 ↔ 桌面桥协议 |
| [EXTENSION-DESKTOP-ALIGNMENT.md](EXTENSION-DESKTOP-ALIGNMENT.md) | 插件与桌面端对齐：连接/数据/能力三层与分阶段计划 |
| [EXTENSION-REFACTOR-PLAN.md](EXTENSION-REFACTOR-PLAN.md) | 下一阶段：插件自己跑新流程、共享 core、设置/数据迁移 |
| [EXTENSION-PARITY.md](EXTENSION-PARITY.md) | 插件—桌面端功能差异、已修问题与暂缓项 |
| [../desktop/docs/PLATFORMS.md](../desktop/docs/PLATFORMS.md) | AI / 检索 / ASR 平台目录 |

## 历史归档

只用于追溯，不代表当前实现：

- [archive/](archive/)：旧验收、UI 审计、功能矩阵、品牌迁移记录
- [../desktop/docs/archive/](../desktop/docs/archive/)：0.30.x 验收、PARITY、REBRAND

## 本地工作区（不进 Git）

仓库外层通常还有：

- `tools/`：CDP 验证脚本，见 `../tools/README.md`
- `artifacts/`：截图与审计 JSON，见 `../artifacts/README.md`

这些内容不要提交到仓库。可重新生成的产物：

```bash
cd repo
rm -rf desktop/out desktop/release desktop/resources/extension verify/build
```

`node_modules` 保留，删掉后需要重新 `npm ci`。

## 文档维护约定

1. 当前文档只写“现在怎么做”；过期内容移到 `docs/archive/` 或 `desktop/docs/archive/`。
2. 版本号、测试数、分组数必须和代码一致；改完至少更新 HANDOFF、QUALITY、README。
3. 不提交安装包、截图、探针、日志和真实用户数据。
4. 新增 Markdown 相对链接后，跑一次链接检查；不要留死链。
