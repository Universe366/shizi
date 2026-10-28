import { describe, expect, it } from 'vitest';
import type { UsageSummary } from '../../../shared/types';
import {
  activeDayCount,
  cacheHitRate,
  dailyAverage,
  dateKey,
  dateRangeKeys,
  formatCost,
  formatPercent,
  formatTokens,
  groupUsage,
  longestStreak,
  peakDay,
  tokensOf,
  topModel
} from './usageStats';

const agg = (requests: number, input: number, output: number, cache = 0) => ({
  requests,
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cache
});

const summary: UsageSummary = {
  totals: agg(3, 3300, 1500, 300),
  byModel: [
    { model: 'deepseek-chat', ...agg(2, 3000, 1200, 300) },
    { model: 'mystery-model', ...agg(1, 300, 300) }
  ],
  byPlatform: [
    { platformId: 'deepseek', platformName: 'DeepSeek', ...agg(2, 3000, 1200, 300) },
    { platformId: 'kimi', platformName: 'Kimi', ...agg(1, 300, 300) }
  ],
  byTask: [
    { task: 'summary', ...agg(2, 3000, 1200, 300) },
    { task: 'translate', ...agg(1, 300, 300) }
  ],
  byDay: [
    { day: '2026-10-01', ...agg(1, 1000, 400) },
    { day: '2026-10-02', ...agg(1, 1000, 400) },
    { day: '2026-10-05', ...agg(1, 1300, 700, 300) }
  ],
  byPlatformModel: [
    { platformId: 'deepseek', platformName: 'DeepSeek', model: 'deepseek-chat', ...agg(2, 3000, 1200, 300) },
    { platformId: 'kimi', platformName: 'Kimi', model: 'mystery-model', ...agg(1, 300, 300) }
  ],
  byTaskModel: [
    { task: 'summary', model: 'deepseek-chat', ...agg(2, 3000, 1200, 300) },
    { task: 'translate', model: 'mystery-model', ...agg(1, 300, 300) }
  ],
  byDayModel: [
    { day: '2026-10-01', model: 'deepseek-chat', ...agg(1, 1000, 400) },
    { day: '2026-10-02', model: 'deepseek-chat', ...agg(1, 1000, 400) },
    { day: '2026-10-05', model: 'deepseek-chat', ...agg(1, 1300, 700, 300) }
  ]
};

const prices = { 'deepseek-chat': { input: 2, output: 8 } };

describe('用量统计计算', () => {
  it('tokens 与缓存命中率', () => {
    expect(tokensOf(agg(1, 100, 50))).toBe(150);
    expect(cacheHitRate(agg(1, 1000, 10, 250))).toBeCloseTo(0.25);
    expect(cacheHitRate(agg(1, 100, 10, 500))).toBe(1);
    expect(cacheHitRate(agg(1, 0, 10))).toBeNull();
  });

  it('活跃天数、连续天数、峰值日与最常用模型', () => {
    expect(activeDayCount(summary.byDay)).toBe(3);
    expect(longestStreak(summary.byDay)).toBe(2);
    expect(peakDay(summary.byDay)?.day).toBe('2026-10-05');
    expect(topModel(summary.byModel)?.model).toBe('deepseek-chat');
    expect(dailyAverage(1000, 4)).toBe(250);
    expect(dailyAverage(1000, 0)).toBe(0);
  });

  it('按模型/平台/任务分组并算成本（无价格时成本为空）', () => {
    const rows = groupUsage(summary, 'model', prices);
    expect(rows.map((row) => row.label)).toContain('deepseek-chat');
    // 缓存命中按半价：2700 全价 + 300 半价 + 1200 输出
    expect(rows[0].cost).toBeCloseTo((2700 * 2 + 300 * 1 + 1200 * 8) / 1_000_000, 8);
    expect(rows.find((row) => row.label === 'mystery-model')?.cost).toBeNull();

    const platforms = groupUsage(summary, 'platform', prices);
    expect(platforms.find((row) => row.label === 'DeepSeek')?.cost).not.toBeNull();
    expect(platforms.find((row) => row.label === 'Kimi')?.cost).toBeNull();

    const tasks = groupUsage(summary, 'task', prices);
    expect(tasks.map((row) => row.label)).toEqual(expect.arrayContaining(['总结', '翻译']));
  });

  it('格式化与日期区间', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_500_000)).toBe('2.50M');
    expect(formatCost(null)).toBe('—');
    expect(formatCost(0)).toBe('¥0');
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(dateKey(new Date(2026, 9, 3))).toBe('2026-10-03');
    expect(dateRangeKeys(new Date(2026, 9, 30), new Date(2026, 10, 2))).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02'
    ]);
  });
});
