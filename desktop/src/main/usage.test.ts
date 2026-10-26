import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import {
  clearUsage,
  closeUsage,
  recordUsage,
  setUsageEnabled,
  usageCsv,
  usageEvents,
  usageSummary
} from './usage';

describe('用量统计', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-usage-'));
  });

  beforeEach(() => {
    closeUsage();
  });

  afterAll(() => {
    closeUsage();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('记录后能按模型/任务/日期汇总', () => {
    recordUsage({
      task: 'summary',
      platformId: 'deepseek',
      platformName: 'DeepSeek',
      model: 'deepseek-chat',
      inputTokens: 1000,
      outputTokens: 500
    });
    recordUsage({
      task: 'chat',
      platformId: 'deepseek',
      platformName: 'DeepSeek',
      model: 'deepseek-chat',
      inputTokens: 300,
      outputTokens: 200,
      cacheReadTokens: 100
    });
    recordUsage({
      task: 'translate',
      platformId: 'moonshot',
      platformName: 'Kimi',
      model: 'moonshot-v1-8k',
      inputTokens: 2000,
      outputTokens: 800
    });

    const summary = usageSummary(7);
    expect(summary.totals.requests).toBe(3);
    expect(summary.totals.inputTokens).toBe(3300);
    expect(summary.totals.outputTokens).toBe(1500);
    expect(summary.byModel.map((row) => row.model).sort()).toEqual([
      'deepseek-chat',
      'moonshot-v1-8k'
    ]);
    expect(summary.byTask.map((row) => row.task).sort()).toEqual([
      'chat',
      'summary',
      'translate'
    ]);
    expect(summary.byDay.length).toBe(1);

    const events = usageEvents(10);
    expect(events.length).toBe(3);
    expect(events[0].createdAt).toBeGreaterThan(0);
  });

  it('空用量与 0 token 不写库', () => {
    clearUsage();
    recordUsage({
      task: 'chat',
      model: 'x',
      inputTokens: 0,
      outputTokens: 0
    });
    expect(usageEvents(10)).toEqual([]);
  });

  it('关闭记录后不再写入，已有数据保留', () => {
    recordUsage({ task: 'chat', model: 'a', inputTokens: 10, outputTokens: 5 });
    setUsageEnabled(false);
    recordUsage({ task: 'chat', model: 'a', inputTokens: 999, outputTokens: 999 });
    expect(usageEvents(10).length).toBe(1);
    setUsageEnabled(true);
  });

  it('CSV 带表头与 BOM', () => {
    recordUsage({ task: 'chat', model: 'deepseek-chat', inputTokens: 10, outputTokens: 5 });
    const csv = usageCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('输入 tokens');
    expect(csv).toContain('deepseek-chat');
  });

  it('清空返回删除条数', () => {
    recordUsage({ task: 'chat', model: 'a', inputTokens: 1, outputTokens: 1 });
    expect(clearUsage()).toBeGreaterThan(0);
    expect(usageEvents(10)).toEqual([]);
  });
});
