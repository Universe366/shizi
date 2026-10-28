import type { AiTask, ModelPrice, UsageAggregate, UsageSummary } from '../../../shared/types';
import { AI_TASK_LABELS, estimateCost } from '../../../shared/aiTasks';

/**
 * 用量统计的纯计算：命中率、活跃天数/连续天数、峰值日、日均、成本与分组。
 * 全部基于 /usage 的汇总结构，方便单测，也避免组件里堆公式。
 */

export type UsageGroupBy = 'model' | 'platform' | 'task';
export type UsageMetric = 'tokens' | 'requests' | 'cost';

export interface UsageGroupRow {
  key: string;
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
}

export interface CostResult {
  cost: number;
  /** 有价格的模型数 / 没有价格（成本被低估）的模型数 */
  priced: number;
  unpriced: number;
}

export function tokensOf(row: UsageAggregate): number {
  return Math.max(0, row.inputTokens) + Math.max(0, row.outputTokens);
}

/** 缓存命中率 = 命中缓存的输入 / 全部输入（输入已含缓存命中）。 */
export function cacheHitRate(row: UsageAggregate): number | null {
  const input = Math.max(0, row.inputTokens);
  if (!input) return null;
  return Math.min(1, Math.max(0, row.cacheReadTokens) / input);
}

export function costOfModelRows(
  rows: Array<{ model: string } & UsageAggregate>,
  prices: Record<string, ModelPrice>
): CostResult {
  let cost = 0;
  let priced = 0;
  let unpriced = 0;
  for (const row of rows) {
    const value = estimateCost(row.model, row, prices);
    if (value === null) {
      unpriced += 1;
      continue;
    }
    cost += value;
    priced += 1;
  }
  return { cost, priced, unpriced };
}

export function activeDayCount(byDay: Array<UsageAggregate & { day: string }>): number {
  return byDay.filter((row) => row.requests > 0).length;
}

/** 最长连续天数（byDay 按日期升序，跨月/跨年按日期差判断）。 */
export function longestStreak(byDay: Array<UsageAggregate & { day: string }>): number {
  const days = Array.from(
    new Set(
      byDay
        .filter((row) => row.requests > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.day))
        .map((row) => {
          const [year, month, day] = row.day.split('-').map(Number);
          // 按 UTC 天序号比较，避开夏令时当天 23/25 小时导致的 ±1 天误差。
          return Math.round(Date.UTC(year, month - 1, day) / 86400000);
        })
    )
  ).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const time of days) {
    if (previous !== null && time - previous === 1) run += 1;
    else if (previous !== null && time === previous) continue;
    else run = 1;
    previous = time;
    best = Math.max(best, run);
  }
  return best;
}

export function peakDay(
  byDay: Array<UsageAggregate & { day: string }>
): (UsageAggregate & { day: string }) | null {
  let best: (UsageAggregate & { day: string }) | null = null;
  for (const row of byDay) {
    if (!row.requests) continue;
    if (!best || tokensOf(row) > tokensOf(best)) best = row;
  }
  return best;
}

export function topModel(
  byModel: Array<UsageAggregate & { model: string }>
): (UsageAggregate & { model: string }) | null {
  let best: (UsageAggregate & { model: string }) | null = null;
  for (const row of byModel) {
    if (!row.requests) continue;
    if (!best || tokensOf(row) > tokensOf(best)) best = row;
  }
  return best;
}

export function dailyAverage(tokens: number, activeDays: number): number {
  if (!activeDays) return 0;
  return Math.round(tokens / activeDays);
}

interface GroupInput {
  key: string;
  label: string;
  aggregate: UsageAggregate;
  cost: number | null;
}

function buildRow(input: GroupInput): UsageGroupRow {
  return {
    key: input.key,
    label: input.label,
    requests: input.aggregate.requests,
    inputTokens: input.aggregate.inputTokens,
    outputTokens: input.aggregate.outputTokens,
    cacheReadTokens: input.aggregate.cacheReadTokens,
    cost: input.cost
  };
}

/** 把汇总按 模型 / 平台 / 任务 拆成可比的行，成本用当前价格表现算。 */
export function groupUsage(
  summary: UsageSummary,
  groupBy: UsageGroupBy,
  prices: Record<string, ModelPrice>
): UsageGroupRow[] {
  if (groupBy === 'platform') {
    return summary.byPlatform.map((row) => {
      const models = summary.byPlatformModel.filter(
        (item) => item.platformId === row.platformId && item.platformName === row.platformName
      );
      const cost = costOfModelRows(models, prices);
      return buildRow({
        key: `${row.platformId}|${row.platformName}`,
        label: row.platformName || '未知平台',
        aggregate: row,
        cost: cost.priced ? cost.cost : null
      });
    });
  }
  if (groupBy === 'task') {
    return summary.byTask.map((row) => {
      const models = summary.byTaskModel.filter((item) => item.task === row.task);
      const cost = costOfModelRows(models, prices);
      return buildRow({
        key: row.task,
        label: AI_TASK_LABELS[row.task as AiTask] || row.task,
        aggregate: row,
        cost: cost.priced ? cost.cost : null
      });
    });
  }
  return summary.byModel.map((row) => {
    const cost = estimateCost(row.model, row, prices);
    return buildRow({
      key: row.model || '(unknown)',
      label: row.model || '(未命名)',
      aggregate: row,
      cost
    });
  });
}

export function metricValue(row: UsageGroupRow, metric: UsageMetric): number {
  if (metric === 'requests') return row.requests;
  if (metric === 'cost') return row.cost ?? 0;
  return tokensOf(row);
}

export function formatTokens(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value <= 0) return '¥0';
  if (value < 0.0001) return '<¥0.0001';
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  if (value < 1) return `¥${value.toFixed(3)}`;
  return `¥${value.toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/** 'YYYY-MM-DD' 的本地日期 key。 */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** 生成从 start 到 end 的连续日期（含端点）。 */
export function dateRangeKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor.getTime() <= last.getTime()) {
    keys.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
