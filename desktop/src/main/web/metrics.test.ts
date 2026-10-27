import { beforeEach, describe, expect, it } from 'vitest';
import { clearSearchMetrics, recentSearches, recordSearch, searchStats } from './metrics';

const base = {
  queries: ['q1'],
  engine: 'P',
  fallback: false,
  cached: false,
  raw: 10,
  deduped: 4,
  fetched: 2,
  elapsedMs: 100,
  failures: 0
};

describe('search metrics', () => {
  beforeEach(() => clearSearchMetrics());

  it('累计次数、平均耗时、去重率与失败率', () => {
    recordSearch({ ...base, elapsedMs: 100, failures: 0 });
    recordSearch({ ...base, elapsedMs: 300, failures: 1, raw: 6, deduped: 3 });
    const stats = searchStats();
    expect(stats.count).toBe(2);
    expect(stats.avgLatency).toBe(200);
    expect(stats.dedupeRate).toBeCloseTo(0.5625, 4);
    expect(stats.failureRate).toBe(0.5);
    expect(stats.fetched).toBe(4);
  });

  it('最近记录按时间倒序', () => {
    recordSearch({ ...base, elapsedMs: 10 });
    recordSearch({ ...base, elapsedMs: 20 });
    const recent = recentSearches(5);
    expect(recent[0].elapsedMs).toBe(20);
    expect(recent[1].elapsedMs).toBe(10);
  });

  it('清空后归零', () => {
    recordSearch({ ...base });
    expect(clearSearchMetrics()).toBe(1);
    expect(searchStats()).toMatchObject({ count: 0, avgLatency: 0, lastAt: null });
  });
});
