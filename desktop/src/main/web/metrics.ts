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
  return size;
}
