export interface SearchMetric {
  at: number;
  queries: string[];
  engine: string;
  fallback: boolean;
  cached: boolean;
  raw: number;
  deduped: number;
  fetched: number;
  elapsedMs: number;
  failures: number;
}

export interface SearchStats {
  count: number;
  avgLatency: number;
  dedupeRate: number;
  failureRate: number;
  fetched: number;
  lastAt: number | null;
}

const MAX_METRICS = 200;
const metrics: SearchMetric[] = [];

export function recordSearch(metric: Omit<SearchMetric, 'at'>): void {
  metrics.push({ ...metric, at: Date.now() });
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
  schedulePersist();
}

export function recentSearches(limit = 30): SearchMetric[] {
  return metrics.slice(-Math.max(1, Math.min(200, limit))).reverse();
}

export function searchStats(): SearchStats {
  if (!metrics.length) {
    return { count: 0, avgLatency: 0, dedupeRate: 0, failureRate: 0, fetched: 0, lastAt: null };
  }
  const count = metrics.length;
  const sumLatency = metrics.reduce((sum, item) => sum + item.elapsedMs, 0);
  const sumRaw = metrics.reduce((sum, item) => sum + item.raw, 0);
  const sumDeduped = metrics.reduce((sum, item) => sum + item.deduped, 0);
  const sumFailures = metrics.reduce((sum, item) => sum + item.failures, 0);
  const fetched = metrics.reduce((sum, item) => sum + item.fetched, 0);
  return {
    count,
    avgLatency: Math.round(sumLatency / count),
    dedupeRate: sumRaw ? Math.max(0, Math.min(1, 1 - sumDeduped / sumRaw)) : 0,
    failureRate: sumFailures / Math.max(1, count),
    fetched,
    lastAt: metrics[count - 1]?.at ?? null
  };
}

export function clearSearchMetrics(): number {
  const size = metrics.length;
  metrics.length = 0;
  void persistNow();
  return size;
}

// ---------- 跨会话持久化 ----------
import fs from 'node:fs';
import path from 'node:path';

let hydrated = false;
let saveTimer: NodeJS.Timeout | null = null;

async function metricsFile(): Promise<string | null> {
  try {
    const { app } = await import('electron');
    return path.join(app.getPath('userData'), 'search-metrics.json');
  } catch {
    return null;
  }
}

/** 一次性把上次会话的指标读进内存；没有文件或解析失败都静默跳过。 */
export async function hydrateMetrics(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const file = await metricsFile();
  if (!file) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return;
    const restored = raw
      .filter((item) => item && Number.isFinite(Number(item.at)))
      .slice(-MAX_METRICS) as SearchMetric[];
    // 内存里已有的记录优先保留，历史记录放在前面。
    metrics.unshift(...restored.slice(0, MAX_METRICS - metrics.length));
  } catch {
    // 首次启动或文件损坏：忽略
  }
}

async function persistNow(): Promise<void> {
  const file = await metricsFile();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(metrics.slice(-MAX_METRICS)));
  } catch {
    // 磁盘只读等异常不影响检索
  }
}

export async function flushMetrics(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistNow();
}

function schedulePersist(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, 800);
}
