import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AiTask,
  UsageAggregate,
  UsageEvent,
  UsageSummary
} from '../shared/types';

// ---------------------------------------------------------------------------
// 用量统计：每次 AI 请求成功后记一条（时间/任务/平台/模型/输入输出 token）。
// 单独放在 usage.db，避免和字幕库的 schema 迁移耦合；损坏时只损失统计。
// ---------------------------------------------------------------------------

let database: DatabaseSync | null = null;
let usageEnabled = true;

/** 设置里关闭「记录用量」后，不再写入新记录（已有数据保留）。 */
export function setUsageEnabled(enabled: boolean): void {
  usageEnabled = enabled !== false;
}

export function usageDbFile(): string {
  return path.join(app.getPath('userData'), 'usage.db');
}

function db(): DatabaseSync | null {
  if (database) return database;
  try {
    fs.mkdirSync(path.dirname(usageDbFile()), { recursive: true });
    database = new DatabaseSync(usageDbFile());
    database.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        task TEXT NOT NULL,
        platform_id TEXT NOT NULL DEFAULT '',
        platform_name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS usage_events_created ON usage_events(created_at);
      CREATE INDEX IF NOT EXISTS usage_events_model ON usage_events(model);
    `);
    return database;
  } catch (error) {
    console.warn('[usage] 打开用量库失败:', (error as Error).message);
    database = null;
    return null;
  }
}

export function closeUsage(): void {
  try {
    database?.close();
  } catch {
    // ignore
  }
  database = null;
}

/** 备份用：VACUUM INTO 得到一致快照。 */
export function backupUsage(target: string): boolean {
  try {
    const store = db();
    if (!store) return false;
    store.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return fs.existsSync(target);
  } catch (error) {
    console.warn('[usage] 备份失败:', (error as Error).message);
    return false;
  }
}

export interface UsageRecord {
  task: AiTask;
  platformId?: string;
  platformName?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export function recordUsage(input: UsageRecord): void {
  if (!usageEnabled) return;
  const inputTokens = Math.max(0, Math.round(Number(input.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(input.outputTokens) || 0));
  if (!inputTokens && !outputTokens) return;
  try {
    db()
      ?.prepare(
        `INSERT INTO usage_events
           (created_at, task, platform_id, platform_name, model, input_tokens, output_tokens, cache_read_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Date.now(),
        String(input.task || 'chat'),
        String(input.platformId || ''),
        String(input.platformName || '').slice(0, 80),
        String(input.model || '').slice(0, 120),
        inputTokens,
        outputTokens,
        Math.max(0, Math.round(Number(input.cacheReadTokens) || 0))
      );
  } catch (error) {
    console.warn('[usage] 写入失败:', (error as Error).message);
  }
}

const ROW_COLUMNS = `id, created_at, task, platform_id, platform_name, model,
  input_tokens, output_tokens, cache_read_tokens`;

interface UsageRow {
  id: number;
  created_at: number;
  task: string;
  platform_id: string;
  platform_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

function mapRow(row: UsageRow): UsageEvent {
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    task: String(row.task) as AiTask,
    platformId: String(row.platform_id || ''),
    platformName: String(row.platform_name || ''),
    model: String(row.model || ''),
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cacheReadTokens: Number(row.cache_read_tokens) || 0
  };
}

function aggregateRow(row: Record<string, unknown>): UsageAggregate {
  return {
    requests: Number(row.requests) || 0,
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    cacheReadTokens: Number(row.cacheReadTokens) || 0
  };
}

const AGG_SELECT = `COUNT(*) AS requests,
  COALESCE(SUM(input_tokens), 0) AS inputTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens`;

export function usageSummary(days = 30): UsageSummary {
  const empty: UsageSummary = {
    totals: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    byModel: [],
    byTask: [],
    byDay: []
  };
  const store = db();
  if (!store) return empty;
  const since = Date.now() - Math.max(1, Math.min(3650, days)) * 86400000;
  try {
    const totalsRow = store
      .prepare(`SELECT ${AGG_SELECT} FROM usage_events WHERE created_at >= ?`)
      .get(since) as Record<string, unknown> | undefined;
    const byModel = store
      .prepare(
        `SELECT model, ${AGG_SELECT} FROM usage_events WHERE created_at >= ?
         GROUP BY model ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC LIMIT 40`
      )
      .all(since) as Array<Record<string, unknown>>;
    const byTask = store
      .prepare(
        `SELECT task, ${AGG_SELECT} FROM usage_events WHERE created_at >= ?
         GROUP BY task ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`
      )
      .all(since) as Array<Record<string, unknown>>;
    const byDay = store
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS day,
                ${AGG_SELECT}
         FROM usage_events WHERE created_at >= ?
         GROUP BY day ORDER BY day ASC`
      )
      .all(since) as Array<Record<string, unknown>>;
    return {
      totals: totalsRow ? aggregateRow(totalsRow) : empty.totals,
      byModel: byModel.map((row) => ({ ...aggregateRow(row), model: String(row.model || '') })),
      byTask: byTask.map((row) => ({ ...aggregateRow(row), task: String(row.task || 'chat') as AiTask })),
      byDay: byDay.map((row) => ({ ...aggregateRow(row), day: String(row.day || '') }))
    };
  } catch (error) {
    console.warn('[usage] 汇总失败:', (error as Error).message);
    return empty;
  }
}

export function usageEvents(limit = 200): UsageEvent[] {
  const store = db();
  if (!store) return [];
  try {
    const rows = store
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM usage_events ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(Math.max(1, Math.min(2000, Math.round(limit)))) as unknown as UsageRow[];
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

export function clearUsage(): number {
  const store = db();
  if (!store) return 0;
  try {
    const before = Number(
      (store.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n?: number })?.n || 0
    );
    store.exec('DELETE FROM usage_events');
    return before;
  } catch {
    return 0;
  }
}

/** CSV 导出（带 BOM，Excel 打开中文不乱码）。 */
export function usageCsv(): string {
  const rows = usageEvents(2000);
  const header = [
    '时间',
    '任务',
    '平台',
    '模型',
    '输入 tokens',
    '输出 tokens',
    '缓存命中 tokens'
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        new Date(row.createdAt).toLocaleString('zh-CN'),
        row.task,
        row.platformName,
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens
      ]
        .map(escape)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
