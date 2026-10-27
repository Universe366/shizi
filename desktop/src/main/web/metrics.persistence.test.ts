import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir }
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-metrics-'));
state.dir = dir;
const file = path.join(dir, 'search-metrics.json');

const metric = {
  queries: ['q1'],
  engine: 'Exa',
  fallback: false,
  cached: false,
  raw: 4,
  deduped: 2,
  fetched: 1,
  elapsedMs: 90,
  failures: 0,
  at: 1_700_000_000_000
};

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('metrics persistence', () => {
  it('flush 后写入 userData 文件', async () => {
    const mod = await import('./metrics');
    mod.recordSearch(metric);
    await mod.flushMetrics();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].engine).toBe('Exa');
  });

  it('新会话从文件恢复', async () => {
    fs.writeFileSync(file, JSON.stringify([metric]));
    vi.resetModules();
    const mod = await import('./metrics');
    await mod.hydrateMetrics();
    expect(mod.searchStats().count).toBe(1);
    expect(mod.recentSearches(5)[0].queries).toEqual(['q1']);
  });
});
