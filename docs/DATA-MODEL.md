# 数据模型与备份

> 适用：桌面端 0.39+。改表结构前先读本文；所有 schema 变更必须走 `desktop/src/main/migrations.ts`。

## 1. 数据放在哪

默认 `userData`：`%APPDATA%\shizi`（旧目录 `bsub-desktop` 首次启动自动迁移）。

| 文件 | 内容 | 是否进备份 |
|---|---|---|
| `settings.json` | 所有设置；API Key / 桥 Token 用 DPAPI 加密 | 是（导出时清空密钥） |
| `library.db` | 视频、字幕、总结、笔记、标签、合集、导出、任务、知识库 | 是 |
| `chat.db` | 对话会话、消息、工具调用记录 | 是 |
| `usage.db` | token 用量事件 | 是 |
| `shizi-location.txt` | 自定义数据目录 | 否 |
| `whisper/` | 本地 ASR 模型 | 否（可重新下载） |
| `logs/` | 运行日志 | 否 |

自定义数据目录后，上述数据库都跟着移动；`shizi-location.txt` 仍留在默认 userData。

## 2. library.db

### 核心表

| 表 | 说明 |
|---|---|
| `videos` | 视频/页面身份：`uid` 唯一，`bvid/cid/ep_id/url/title/owner/duration` |
| `tracks` | 字幕轨：`video_id/lan/lan_doc/source`，一条视频多语言多轨 |
| `segments` | 字幕行：`track_id/start_ms/end_ms/text` |
| `segments_fts` | FTS5 全文索引（trigram）；FTS5 不可用时退化为 LIKE |
| `summaries` / `summary_versions` | 总结正文、模型、核对结果与历史版本 |
| `notes` / `note_versions` | 笔记 Markdown 与历史版本 |
| `tags` / `video_tags` | 标签 |
| `collections` / `collection_items` | 合集与视频归属 |
| `collection_summaries` / `collection_summary_versions` | 合集级总结 |
| `exports` | 导出记录 |
| `jobs` / `job_items` | 任务中心（转写/合成/批处理） |

### 知识库（migration 6 / 7，入口已移除）

> 工作台与设置里的知识库入口已移除；表和索引保留，避免老库迁移/数据丢失。

| 表 | 说明 |
|---|---|
| `kb_chunks` | 切块：`video_id/kind(start 字幕/summary/note/meta)/start_ms/end_ms/text/hash` |
| `kb_vectors` | 向量：`chunk_id/model/dim/vector`（Float32 BLOB），按模型区分 |
| `kb_states`（v7） | 学习状态：`video_id/status(new·learning·review·mastered)/updated_at` |
| `kb_qa`（v8） | 问答历史：`question/answer/mode/scope_label/hits_json/created_at` |
| `kb_mentions`（v8） | 双向链接：`qa_id/video_id`（每条回答引用过哪些视频） |
| `kb_cards`（v8） | 复习卡片：`video_id/front/back/due_at/interval_days/streak` |

索引流程：`collectChunks()` 重建 `kb_chunks` → 调 `/embeddings` → 写 `kb_vectors`。
检索用「向量余弦 + 关键词覆盖率」混合打分，模型名必须与建索引时一致。
范围过滤：单篇按 `video_id`，合集按 `collection_items` 的视频集合生成 `IN (...)`。

### 迁移

- 版本号在 `PRAGMA user_version`，`LATEST_SCHEMA_VERSION` 当前为 **6**。
- 每一步必须幂等；新表用 `CREATE TABLE IF NOT EXISTS`，加列先查 `PRAGMA table_info`。
- 不要在 `schema.ts` 里手改后假设老库会升级。
- 升级后验证：`npm run smoke` 会启动真实库；`src/main/trash.test.ts`、`diagnostics.test.ts` 断言 schema 版本。

## 3. chat.db

单独库，避免对话把 library.db 撑大。

```sql
conversations(
  id, title, video_key, video_title,
  profile_id DEFAULT '',          -- migration: 会话绑定的助手档案
  created_at, updated_at
)
messages(
  id, conversation_id, role, content, reasoning, model,
  images_json, sources_json, web_engine, web_notice,
  tools_json DEFAULT '[]',        -- migration: 工具调用记录
  created_at
)
```

- `video_key` 来自页面身份（B 站 uid/URL），用来按视频归组会话。
- `tools_json` 存 `{ name, ok, detail }[]`，渲染历史时还原工具卡片。
- 分支不复制整库：`branchConversation(sourceId, keep)` 建新会话并复制前 N 条。
- 删除会话会删消息；`chat.db` 已纳入备份。

## 4. usage.db

```sql
usage_events(
  id, created_at, task, platform_id, platform_name,
  model, input_tokens, output_tokens, cache_read_tokens
)
```

- 每条 AI 请求完成后写入；流式请求在 usage 到达时写。
- 成本不落库，按设置里的价格表实时计算，避免历史价格变化后对不上。
- `usage:summary` 支持 7/30/90/365 天；CSV 导出最多最近 2000 条。

## 5. settings.json

- 结构见 `shared/types.ts` 的 `AppSettings`，默认值在 `main/settings.ts`。
- 读取时做归一化：缺字段补默认、非法值回退，保证旧版本设置能打开。
- 敏感字段：
  - `ai.platforms[].apiKey`、`asrPlatforms[].apiKey`、额外 Key：DPAPI 加密；
  - 备份/导出时清空；
  - 日志与诊断不得输出。
- 新增设置时同步：类型 → 默认值 → 归一化 → 设置 UI → 测试（参考 `settings.tasks.test.ts`）。

## 6. 备份与恢复

`main/backup.ts`：

1. 备份目录 `bsub-backup-YYYYMMDD-HHmmss/`，含 `manifest.json`（SHA-256）、`README.txt`、`settings.json`、`library.db`，存在时加 `chat.db`、`usage.db`。
2. 数据库用 `VACUUM INTO` 取一致快照，不直接拷贝正在写的 WAL。
3. 恢复：
   - 先校验 manifest；
   - 把当前数据复制到 `pre-restore-*`；
   - 关闭 library/chat/usage，清 WAL/SHM，再复制备份文件；
   - 设置用合并而不是覆盖，保留本机 Key；
   - 默认重启应用（测试可设 `BSUB_RESTORE_NO_RELAUNCH=1`）。

**改数据格式时，必须同时更新恢复逻辑与 `backup.test.ts`。**

## 7. 常见排查

| 现象 | 看哪里 |
|---|---|
| 升级后打开空白 | `library.db` 是否被旧进程锁；看日志 migration 是否抛错 |
| 知识库检索不到 | `kb_vectors.model` 是否与当前设置模型一致；是否重建过 |
| 对话历史少了工具卡片 | `messages.tools_json` 是否为空；老库迁移是否执行 |
| 备份缺对话 | `chat.db` 是否在备份目录；manifest 是否包含 |
| 数据目录不对 | `shizi-location.txt` 与 `app.getPath('userData')` |
